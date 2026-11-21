#include "dc24h/configuration/configuration.hpp"

#include <fcntl.h>
#include <unistd.h>

#include <filesystem>
#include <fstream>
#include <iostream>
#include <source_location>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
namespace fs = std::filesystem;
void require(bool condition, std::source_location loc = std::source_location::current()) {
    if (!condition) { throw std::runtime_error("Configuration review assertion at line " + std::to_string(loc.line())); }
}
template <typename Callback>
void refused(Callback fn) {
    bool rejected = false;
    try { fn(); } catch (const std::exception&) { rejected = true; }
    require(rejected);
}
struct TempFile {
    fs::path path;
    TempFile() {
        auto pattern = (fs::temp_directory_path() / "dc24h-review-XXXXXX").string();
        std::vector<char> mutable_name(pattern.begin(), pattern.end());
        mutable_name.push_back('\0');
        const int fd = ::mkstemp(mutable_name.data());
        if (fd < 0) { throw std::runtime_error("Cannot create test file"); }
        ::close(fd);
        path = mutable_name.data();
    }
    ~TempFile() { std::error_code error; fs::remove(path, error); }
    void write(std::string_view text) const {
        std::ofstream stream(path, std::ios::binary | std::ios::trunc);
        stream << text;
        require(stream.good());
    }
};
}

int main() {
    try {
        using namespace dc24h::configuration;
        TempFile ini;
        ini.write("[network]\nmax_connections = 128\nidle_timeout = 120\n[logging]\nlevel = info\n[general]\nlanguage = us\n# secret-marker-dont-expose\n");
        const auto initial = load_file(ini.path.string());
        Review review(initial);
        const auto first = review.read();
        require(first.matches_active);
        require(first.revision.size() == 64);
        require(first.saved.size() == 4 && first.saved[0].key == "network_max_connections");
        require(first.saved[0].value == "128" && first.active[0].value == "128");
        for (const auto& field : first.saved) {
            require(field.value.find("secret-marker") == std::string::npos);
        }
        require(review.validate_candidate(first.revision, {{"network_max_connections", "256"}, {"logging_level", "warning"}}));
        refused([&] { (void)review.validate_candidate(first.revision,
            {{"network_max_connections", "256"}, {"network_max_connections", "300"}}); });
        refused([&] { (void)review.validate_candidate(first.revision,
            {{"logging_level", "warning"}, {"logging_level", "warning"}}); });
        require(!review.validate_candidate(first.revision, {{"network_max_connections", "0"}}));
        require(!review.validate_candidate(first.revision, {{"network_max_connections", "65536"}}));
        require(!review.validate_candidate(first.revision, {{"general_language", "en"}}));
        require(!review.validate_candidate(first.revision, {{"network_idle_timeout", "-1"}}));
        require(!review.validate_candidate(first.revision, {{"logging_level", "debug"}}));
        refused([&] { (void)review.validate_candidate(first.revision, {}); });
        require(!review.validate_candidate(first.revision, {{"unexpected_option", "value"}}));
        // The preview is not a write operation.
        std::ifstream check(ini.path, std::ios::binary);
        const std::string unchanged((std::istreambuf_iterator<char>(check)), std::istreambuf_iterator<char>());
        require(unchanged.find("max_connections = 128") != std::string::npos);
        ini.write("[network]\nmax_connections = 256\nidle_timeout = 120\n[logging]\nlevel = info\n[general]\nlanguage = us\n");
        const auto second = review.read();
        require(second.revision != first.revision);
        require(!second.matches_active && second.saved[0].value == "256" && second.active[0].value == "128");
        bool stale = false;
        try { (void)review.validate_candidate(first.revision, {{"network_max_connections", "300"}}); }
        catch (const StaleReview&) { stale = true; }
        require(stale);
        require(review.validate_candidate(second.revision, {{"network_idle_timeout", "1"}}));
        ini.write("[network]\nmax_connections = 256\nidle_timeout = 120\n# a comment-only edit must invalidate the revision\n");
        refused([&] { (void)review.validate_candidate(second.revision, {{"network_idle_timeout", "1"}}); });
        ini.write("[network]\nmax_connections = 0\n");
        refused([&] { (void)review.read(); });
        ini.write("[network]\nmax_connections = broken\n");
        refused([&] { (void)review.validate_candidate(second.revision, {{"network_idle_timeout", "120"}}); });
        ini.write(std::string(65537, 'x'));
        refused([&] { (void)review.read(); });
        // Sixteen comment lines fit the 64 KiB source limit exactly. The
        // proposed key is valid, but serializing it would exceed that limit.
        std::string near_limit;
        const std::string comment = "#" + std::string(4094, 'x') + "\n";
        for (std::size_t i = 0; i < 16; ++i) { near_limit += comment; }
        require(near_limit.size() == 65536);
        ini.write(near_limit);
        const auto full_review = review.read();
        require(!review.validate_candidate(full_review.revision, {{"network_max_connections", "256"}}));
        ini.write(std::string("[network]\nmax_connections=128\n\0", 31));
        refused([&] { (void)review.read(); });
        fs::remove(ini.path);
        require(::symlink("/etc/passwd", ini.path.c_str()) == 0);
        refused([&] { (void)review.read(); });
        std::cout << "Read-only configuration review passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
