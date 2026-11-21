#include "dc24h/configuration/configuration.hpp"

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <filesystem>
#include <fstream>
#include <cstdlib>
#include <iostream>
#include <iterator>
#include <source_location>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace {
namespace fs = std::filesystem;
void require(bool value, std::source_location loc = std::source_location::current()) {
    if (!value) { throw std::runtime_error("Configuration write assertion at line " + std::to_string(loc.line())); }
}
template <class F> void rejects(F&& action) {
    bool rejected = false;
    try { action(); } catch (const std::exception&) { rejected = true; }
    require(rejected);
}
struct PrivateDirectory {
    fs::path path, ini;
    PrivateDirectory() {
        auto pattern = (fs::temp_directory_path() / "dc24h-write-XXXXXX").string();
        std::vector<char> chars(pattern.begin(),pattern.end());chars.push_back('\0');
        require(::mkdtemp(chars.data()) != nullptr);
        path = chars.data();
        ini = path / "hub.ini";
        const int fd = ::open(ini.c_str(),O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC,0600);
        require(fd >= 0);(void)::close(fd);
    }
    ~PrivateDirectory() { std::error_code ignored;fs::remove_all(path,ignored); }
    void put(std::string_view bytes) const {
        std::ofstream out(ini,std::ios::binary | std::ios::trunc);out << bytes;require(out.good());
    }
};
std::string contents(const fs::path& path) {
    std::ifstream in(path,std::ios::binary);
    require(in.good());
    return {std::istreambuf_iterator<char>(in),std::istreambuf_iterator<char>()};
}
mode_t mode(const fs::path& path) {
    struct stat state{};require(::stat(path.c_str(),&state)==0);return state.st_mode & 0777;
}
}

int main() {
    try {
        using namespace dc24h::configuration;
        PrivateDirectory temp;
        const std::string original = "[network]\nmax_connections = 128\nidle_timeout=120\n"
            "[logging]\nlevel=info\n[general]\nlanguage=us\n# unmodified comment\n";
        temp.put(original);
        const auto initial = load_file(temp.ini.string());
        Review review(initial);
        const auto before = review.read();
        rejects([&] { (void)review.write_candidate(before.revision,{{"network_max_connections","0"}}); });
        rejects([&] { (void)review.write_candidate(before.revision,{{"network_max_connections","150"},
            {"network_max_connections","160"}}); });
        require(contents(temp.ini)==original);
        const auto updated = review.write_candidate(before.revision,{{"network_max_connections","256"},
            {"logging_level","warning"}});
        const auto changed = review.read();
        require(changed.revision==updated && !changed.matches_active);
        require(changed.saved[0].value=="256" && changed.saved[2].value=="warning");
        require(contents(temp.ini).find("# unmodified comment")!=std::string::npos);
        const fs::path backup=temp.ini.string()+".dc24h.bak";
        require(contents(backup)==original && mode(backup)==0600 && mode(temp.ini)==0600);
        rejects([&] { (void)review.write_candidate(before.revision,{{"network_max_connections","300"}}); });
        const auto restored=review.restore_backup(updated);
        require(restored==before.revision && contents(temp.ini)==original);
        require(contents(temp.ini.string()+".dc24h.undo").find("max_connections = 256")!=std::string::npos);
        require(mode(temp.ini.string()+".dc24h.undo")==0600);
        rejects([&] { (void)review.restore_backup(updated); });
        // Repeating restore with the current revision must not destroy the
        // only undo generation or replace the saved pre-restore bytes.
        const auto undo_before=contents(temp.ini.string()+".dc24h.undo");
        bool already_restored=false;
        try { (void)review.restore_backup(restored); }
        catch (const StaleReview&) { already_restored=true; }
        require(already_restored);
        require(contents(temp.ini.string()+".dc24h.undo")==undo_before);
        require(contents(temp.ini)==original);
        require(::chmod(temp.ini.c_str(),0666)==0);
        rejects([&] { (void)review.write_candidate(restored,{{"network_idle_timeout","160"}}); });
        require(::chmod(temp.ini.c_str(),0600)==0);
        require(::chmod(temp.path.c_str(),0777)==0);
        rejects([&] { (void)review.write_candidate(restored,{{"network_idle_timeout","160"}}); });
        require(::chmod(temp.path.c_str(),0700)==0);
        fs::remove(backup);
        require(::symlink("/etc/passwd",backup.c_str())==0);
        rejects([&] { (void)review.restore_backup(restored); });
        rejects([&] { (void)review.write_candidate(restored,{{"network_idle_timeout","160"}}); });
        require(contents(temp.ini)==original);
        std::cout << "Configuration atomic write/restore checks passed\n";
        return 0;
    } catch (const std::exception& error) { std::cerr << error.what() << '\n';return 1; }
}
