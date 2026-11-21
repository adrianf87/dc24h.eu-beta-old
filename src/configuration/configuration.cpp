#include "dc24h/configuration/configuration.hpp"

#include <arpa/inet.h>
#include <fcntl.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>
#include <utf8proc.h>
#include <openssl/crypto.h>
#include <openssl/hmac.h>
#include <openssl/rand.h>

#include <array>
#include <cerrno>
#include <charconv>
#include <filesystem>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <unordered_set>

namespace dc24h::configuration {
namespace {
namespace fs = std::filesystem;
constexpr std::size_t max_file_bytes = 65536;
constexpr std::size_t max_line_bytes = 4096;
constexpr std::size_t max_welcome_line_bytes = 8192;

std::string trim(std::string_view value) {
    // INI whitespace is deliberately ASCII and independent of the process locale.
    while (!value.empty() && (value.front() == ' ' || value.front() == '\t')) { value.remove_prefix(1); }
    while (!value.empty() && (value.back() == ' ' || value.back() == '\t')) { value.remove_suffix(1); }
    return std::string(value);
}

unsigned int positive_number(std::string_view value, unsigned int maximum) {
    unsigned int parsed{};
    const auto [end, error] = std::from_chars(value.data(), value.data() + value.size(), parsed);
    if (error != std::errc{} || end != value.data() + value.size() || parsed == 0 || parsed > maximum) {
        throw std::invalid_argument("Invalid numeric configuration value");
    }
    return parsed;
}

logging::Level level(std::string_view value) {
    if (value == "info") { return logging::Level::info; }
    if (value == "warning") { return logging::Level::warning; }
    if (value == "error") { return logging::Level::error; }
    if (value == "off") { return logging::Level::off; }
    throw std::invalid_argument("Log level must be info, warning, error or off");
}

bool connection_logging(std::string_view value) {
    if (value == "on") { return true; }
    if (value == "off") { return false; }
    throw std::invalid_argument("Connection logging must be on or off");
}
bool transfer_switch(std::string_view value) {
    if (value == "on") { return true; }
    if (value == "off") { return false; }
    throw std::invalid_argument("Transfer switches must be on or off");
}

void path_text(std::string_view value) {
    if (value.empty()) { throw std::invalid_argument("Empty configuration path"); }
    for (const unsigned char c : value) {
        if (c < 32 || c == 127) { throw std::invalid_argument("Invalid control character in path"); }
    }
}

std::string resolve_path(std::string_view value, const fs::path& base) {
    path_text(value);
    const fs::path path(value);
    // Do not lexically collapse symlink/.. before filesystem resolution.
    return (path.is_absolute() ? path : base / path).string();
}

bool same_file(const fs::path& a, const fs::path& b) {
    std::error_code ec;
    if (fs::equivalent(a, b, ec) && !ec) { return true; }
    ec.clear();
    const auto first = fs::weakly_canonical(a, ec);
    if (ec) { throw std::invalid_argument("Cannot resolve configured path"); }
    const auto second = fs::weakly_canonical(b, ec);
    if (ec) { throw std::invalid_argument("Cannot resolve configured path"); }
    return first == second;
}

struct ListenerList {
    bool seen{false};
    bool disabled{false};
    void add(Settings& settings, std::vector<network::Endpoint>& listeners, std::string_view value) {
        if (settings.implicit_plain_listener) {
            settings.network.listeners.clear();
            settings.implicit_plain_listener = false;
        }
        if (!seen) { listeners.clear(); seen = true; }
        if (value == "none") {
            if (!listeners.empty() || disabled) {
                throw std::invalid_argument("none cannot be combined with listener addresses");
            }
            disabled = true;
        } else {
            if (disabled || listeners.size() == 16) { throw std::invalid_argument("Invalid listener list"); }
            listeners.push_back(network::parse_endpoint(value));
        }
    }
};

void validate_endpoints(const std::vector<network::Endpoint>& list, std::unordered_set<std::string>& seen) {
    for (const auto& endpoint : list) {
        const bool ipv6 = endpoint.address.find(':') != std::string::npos;
        (void)network::parse_endpoint((ipv6 ? "[" + endpoint.address + "]" : endpoint.address)
                                     + ":" + std::to_string(endpoint.port));
        std::array<unsigned char, 16> address{};
        std::array<char, INET6_ADDRSTRLEN> normalized{};
        const int family = ipv6 ? AF_INET6 : AF_INET;
        if (::inet_pton(family, endpoint.address.c_str(), address.data()) != 1 ||
            ::inet_ntop(family, address.data(), normalized.data(), normalized.size()) == nullptr) {
            throw std::invalid_argument("Invalid listener address");
        }
        const auto key = std::string(normalized.data()) + ":" + std::to_string(endpoint.port);
        // Port zero requests independent ephemeral sockets, so it may be repeated.
        if (endpoint.port != 0 && !seen.insert(key).second) {
            throw std::invalid_argument("Duplicate listener endpoint");
        }
    }
}

std::string read_fd(int fd) {
    struct stat state{};
    if (::fstat(fd, &state) != 0 || !S_ISREG(state.st_mode) || state.st_size < 0 ||
        static_cast<std::uintmax_t>(state.st_size) > max_file_bytes) {
        throw std::invalid_argument("Configuration must be a regular file of at most 64 KiB");
    }
    std::array<char, 4096> buffer{};
    std::string data;
    for (;;) {
        const auto count = ::read(fd, buffer.data(), buffer.size());
        if (count < 0 && errno == EINTR) { continue; }
        if (count < 0) { throw std::invalid_argument("Configuration read failure"); }
        if (count == 0) { break; }
        if (data.size() + static_cast<std::size_t>(count) > max_file_bytes) {
            throw std::invalid_argument("Configuration file exceeds 64 KiB");
        }
        data.append(buffer.data(), static_cast<std::size_t>(count));
    }
    for (std::size_t i = 0; i < data.size();) {
        utf8proc_int32_t codepoint{};
        const auto count = utf8proc_iterate(reinterpret_cast<const utf8proc_uint8_t*>(data.data() + i),
                                            static_cast<utf8proc_ssize_t>(data.size() - i), &codepoint);
        if (count <= 0 || (codepoint < 32 && codepoint != '\t' && codepoint != '\n' && codepoint != '\r') ||
            codepoint == 127) {
            throw std::invalid_argument("Configuration must be UTF-8 without control characters");
        }
        i += static_cast<std::size_t>(count);
    }
    return data;
}
std::string read_file(const std::string& filename) {
    path_text(filename);
    const int fd = ::open(filename.c_str(), O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK | O_NOCTTY);
    if (fd < 0) { throw std::invalid_argument("Cannot open configuration file (regular file required, no symlink)"); }
    struct Close { int fd; ~Close() { ::close(fd); } } close{fd};
    return read_fd(fd);
}
} // namespace

void validate(const Settings& settings) {
    database::validate(settings.database);
    api::validate(settings.api);
    const auto& net = settings.network;
    if (settings.authentication.max_accounts == 0 || settings.authentication.max_accounts > 4096) {
        throw std::invalid_argument("Invalid ADC authentication configuration");
    }
    if (settings.authentication.enabled && (!settings.database.enabled || settings.authentication.key_file.empty() ||
        settings.authentication.max_accounts == 0 || settings.authentication.max_accounts > 4096 ||
        (settings.authentication.require_tls && net.tls_listeners.empty()))) {
        throw std::invalid_argument("ADC authentication requires database, private key and compatible listeners");
    }
    if (!settings.authentication.key_file.empty()) {
        path_text(settings.authentication.key_file);
        for (const auto& other : {settings.database.password_file,settings.api.token_file,settings.source_file,net.tls_private_key,net.tls_certificate}) {
            if (!other.empty() && same_file(settings.authentication.key_file,other)) {
                throw std::invalid_argument("ADC authentication key must use a separate private file");
            }
        }
    }
    security::validate(net.security);
    security::validate(net.authentication_limits);
    security::validate(net.roles);
    users::validate(net.users);
    chat::validate_settings(net.chat);
    search::validate_security(net.search);
    transfers::validate_limits(net.transfers.flood);
    const auto count = net.listeners.size() + net.tls_listeners.size();
    if (count == 0 || count > 16 || net.max_connections == 0 || net.max_connections > 65535 ||
        net.idle_timeout.count() < 1 || net.idle_timeout.count() > 86400) {
        throw std::invalid_argument("Invalid listener or connection limits");
    }
    const bool tls = !net.tls_listeners.empty();
    if (tls != (!net.tls_certificate.empty() && !net.tls_private_key.empty()) ||
        (!tls && (!net.tls_certificate.empty() || !net.tls_private_key.empty()))) {
        throw std::invalid_argument("ADCS requires listeners, a certificate and a private key");
    }
    std::unordered_set<std::string> endpoints;
    validate_endpoints(net.listeners, endpoints);
    validate_endpoints(net.tls_listeners, endpoints);
    if (tls) { path_text(net.tls_certificate); path_text(net.tls_private_key); }
    if (!settings.source_file.empty()) { path_text(settings.source_file); }
    if (!settings.api.socket_path.empty()) {
        for (const auto& protected_path : {settings.source_file, net.tls_certificate, net.tls_private_key,
                settings.database.password_file, settings.database.socket, settings.api.token_file, settings.logging.file_path, settings.authentication.key_file}) {
            if (!protected_path.empty() && same_file(settings.api.socket_path, protected_path)) {
                throw std::invalid_argument("API socket cannot target configuration or credential files");
            }
        }
    }
    const auto& log = settings.logging;
    if (log.level != logging::Level::info && log.level != logging::Level::warning && log.level != logging::Level::error && log.level != logging::Level::off) {
        throw std::invalid_argument("Invalid log level");
    }
    if (log.language != i18n::Language::us && log.language != i18n::Language::pl) {
        throw std::invalid_argument("Unknown language (use us or pl)");
    }
    if (!log.file_path.empty()) {
        path_text(log.file_path);
        for (const auto& protected_path : {settings.source_file, net.tls_certificate, net.tls_private_key, settings.database.password_file, settings.api.token_file, settings.api.socket_path, settings.authentication.key_file}) {
            if (!protected_path.empty() && same_file(log.file_path, protected_path)) {
                throw std::invalid_argument("Log file cannot target configuration or credential files");
            }
        }
    }
}

api::ConfigurationSnapshot public_settings(const Settings& settings, bool maintenance) {
    validate(settings);
    if (maintenance && settings.authentication.enabled) { throw std::invalid_argument("Invalid ADC authentication configuration"); }
    const auto timeouts=database::effective_timeouts(settings.database);
    api::ConfigurationSnapshot out;
    out.maintenance=maintenance;out.database_enabled=settings.database.enabled;
    out.timeout_seconds=settings.database.timeout;out.connect_timeout_seconds=timeouts.connect;
    out.read_timeout_seconds=timeouts.read;out.write_timeout_seconds=timeouts.write;
    out.authentication_enabled=settings.authentication.enabled;out.require_tls=settings.authentication.require_tls;
    out.max_accounts=settings.authentication.max_accounts;out.attempts=settings.network.authentication_limits;
    out.login=settings.network.security;out.roles=settings.network.roles;return out;
}

namespace {
Settings parse_file_data(const std::string& filename, const std::string& data) {
    std::error_code ec;
    const auto path = fs::canonical(filename, ec);
    if (ec) { throw std::invalid_argument("Cannot resolve configuration file path"); }
    Settings settings;
    settings.source_file = path.string();
    std::istringstream input(data);
    std::string section;
    std::unordered_set<std::string> singletons;
    ListenerList plain, tls;
    std::string line;
    std::size_t line_number = 0;
    while (std::getline(input, line)) {
        ++line_number;
        if (line.size() > max_line_bytes) {
            // A maximum-size welcome also needs room for its key, whitespace
            // and CR. Other physical lines retain their existing bound.
            const auto equal = line.find('=');
            if (line.size() > max_welcome_line_bytes || section != "chat" || equal == std::string::npos ||
                trim(std::string_view(line).substr(0, equal)) != "welcome_message") {
                throw std::invalid_argument("Invalid configuration line " + std::to_string(line_number));
            }
        }
        if (!line.empty() && line.back() == '\r') { line.pop_back(); }
        if (line.find('\r') != std::string::npos) {
            throw std::invalid_argument("Invalid configuration line " + std::to_string(line_number));
        }
        if (line_number == 1 && line.starts_with("\xEF\xBB\xBF")) { line.erase(0, 3); }
        const auto text = trim(line);
        if (text.empty() || text.front() == '#' || text.front() == ';') { continue; }
        if (text.front() == '[') {
            if (text.back() != ']' || text.size() < 3) {
                throw std::invalid_argument("Invalid section at line " + std::to_string(line_number));
            }
            section = trim(std::string_view(text).substr(1, text.size() - 2));
            if (section != "network" && section != "tls" && section != "logging" && section != "general" && section != "security" && section != "database" && section != "api" && section != "users" && section != "chat" && section != "search" && section != "transfers" && section != "authentication" && section != "roles") {
                throw std::invalid_argument("Unknown configuration section at line " + std::to_string(line_number));
            }
            continue;
        }
        const auto equal = text.find('=');
        if (equal == std::string::npos || section.empty()) {
            throw std::invalid_argument("Expected section and key=value at line " + std::to_string(line_number));
        }
        const auto key = trim(std::string_view(text).substr(0, equal));
        const auto value = trim(std::string_view(text).substr(equal + 1));
        if (!(section == "network" && (key == "listen" || key == "adcs_listen")) &&
            !singletons.insert(section + "." + key).second) {
            throw std::invalid_argument("Duplicate configuration key at line " + std::to_string(line_number));
        }
        try {
            if (section == "network" && key == "listen") {
                plain.add(settings, settings.network.listeners, value);
            } else if (section == "network" && key == "adcs_listen") {
                tls.add(settings, settings.network.tls_listeners, value);
            } else if (section == "network" && key == "max_connections") {
                settings.network.max_connections = positive_number(value, 65535);
            } else if (section == "network" && key == "idle_timeout") {
                settings.network.idle_timeout = std::chrono::seconds(positive_number(value, 86400));
            } else if (section == "users" && key == "max_sessions") {
                settings.network.users.max_sessions = positive_number(value, 65535);
            } else if (section == "users" && key == "max_users") {
                settings.network.users.max_users = positive_number(value, 65535);
            } else if (section == "chat" && key == "max_messages_per_second") {
                settings.network.chat.flood.messages_per_second = positive_number(value, chat::max_message_rate);
            } else if (section == "chat" && key == "message_burst") {
                settings.network.chat.flood.message_burst = positive_number(value, chat::max_message_rate);
            } else if (section == "chat" && key == "max_bytes_per_second") {
                settings.network.chat.flood.bytes_per_second = positive_number(value, chat::max_byte_rate);
            } else if (section == "chat" && key == "byte_burst") {
                settings.network.chat.flood.byte_burst = positive_number(value, chat::max_byte_rate);
            } else if (section == "chat" && key == "max_text_bytes") {
                settings.network.chat.policy.max_text_bytes = positive_number(value, text::max_chat_text_bytes);
            } else if (section == "chat" && key == "public_enabled") {
                settings.network.chat.policy.public_enabled = connection_logging(value);
            } else if (section == "chat" && key == "private_enabled") {
                settings.network.chat.policy.private_enabled = connection_logging(value);
            } else if (section == "chat" && key == "actions_enabled") {
                settings.network.chat.policy.actions_enabled = connection_logging(value);
            } else if (section == "chat" && key == "welcome_enabled") {
                settings.network.chat.welcome_enabled = connection_logging(value);
            } else if (section == "chat" && key == "welcome_message") {
                settings.network.chat.welcome_message = value;
            } else if (section == "transfers" && key == "allowed_protocols") {
                settings.network.transfers.allowed_protocols = transfers::ProtocolPolicy::parse(value);
            } else if (section == "transfers" && key == "ctm_enabled") {
                settings.network.transfers.ctm_enabled = transfer_switch(value);
            } else if (section == "transfers" && key == "rcm_enabled") {
                settings.network.transfers.rcm_enabled = transfer_switch(value);
            } else if (section == "transfers" && key == "guest_initiate") {
                settings.network.transfers.guests.initiate = transfer_switch(value);
            } else if (section == "transfers" && key == "guest_receive") {
                settings.network.transfers.guests.receive = transfer_switch(value);
            } else if (section == "transfers" && key == "request_rate") {
                settings.network.transfers.flood.requests.rate = positive_number(value, transfers::max_request_rate);
            } else if (section == "transfers" && key == "request_burst") {
                settings.network.transfers.flood.requests.burst = positive_number(value, transfers::max_request_rate);
            } else if (section == "transfers" && key == "request_byte_rate") {
                settings.network.transfers.flood.requests.byte_rate = positive_number(value, transfers::max_transfer_byte_rate);
            } else if (section == "transfers" && key == "request_byte_burst") {
                settings.network.transfers.flood.requests.byte_burst = positive_number(value, transfers::max_transfer_byte_rate);
            } else if (section == "transfers" && key == "incoming_rate") {
                settings.network.transfers.flood.incoming.rate = positive_number(value, transfers::max_request_rate);
            } else if (section == "transfers" && key == "incoming_burst") {
                settings.network.transfers.flood.incoming.burst = positive_number(value, transfers::max_request_rate);
            } else if (section == "transfers" && key == "incoming_byte_rate") {
                settings.network.transfers.flood.incoming.byte_rate = positive_number(value, transfers::max_transfer_byte_rate);
            } else if (section == "transfers" && key == "incoming_byte_burst") {
                settings.network.transfers.flood.incoming.byte_burst = positive_number(value, transfers::max_transfer_byte_rate);
            } else if (section == "search" && key == "queries_enabled") {
                settings.network.search.queries_enabled = connection_logging(value);
            } else if (section == "search" && key == "results_enabled") {
                settings.network.search.results_enabled = connection_logging(value);
            } else if (section == "search" && key == "guest_queries") {
                settings.network.search.guests.queries = connection_logging(value);
            } else if (section == "search" && key == "guest_results") {
                settings.network.search.guests.results = connection_logging(value);
            } else if (section == "search" && key == "require_result_token") {
                settings.network.search.require_result_token = connection_logging(value);
            } else if (section == "search" && key == "max_active_searches") {
                settings.network.search.tokens.total = positive_number(value, 65535);
            } else if (section == "search" && key == "max_active_per_user") {
                settings.network.search.tokens.per_owner = positive_number(value, 64);
            } else if (section == "search" && key == "search_lifetime_seconds") {
                settings.network.search.tokens.lifetime = std::chrono::seconds(positive_number(value, 3600));
            } else if (section == "search" && key == "query_rate") {
                settings.network.search.queries.rate = positive_number(value, search::max_operation_rate);
            } else if (section == "search" && key == "query_burst") {
                settings.network.search.queries.burst = positive_number(value, search::max_operation_rate);
            } else if (section == "search" && key == "query_byte_rate") {
                settings.network.search.queries.byte_rate = positive_number(value, search::max_security_byte_rate);
            } else if (section == "search" && key == "query_byte_burst") {
                settings.network.search.queries.byte_burst = positive_number(value, search::max_security_byte_rate);
            } else if (section == "search" && key == "result_rate") {
                settings.network.search.results.rate = positive_number(value, search::max_operation_rate);
            } else if (section == "search" && key == "result_burst") {
                settings.network.search.results.burst = positive_number(value, search::max_operation_rate);
            } else if (section == "search" && key == "result_byte_rate") {
                settings.network.search.results.byte_rate = positive_number(value, search::max_security_byte_rate);
            } else if (section == "search" && key == "result_byte_burst") {
                settings.network.search.results.byte_burst = positive_number(value, search::max_security_byte_rate);
            } else if (section == "security" && key == "max_connections_per_ip") {
                settings.network.security.max_connections_per_ip = positive_number(value, 65535);
            } else if (section == "security" && key == "max_accepts_per_minute") {
                settings.network.security.max_accepts_per_minute = positive_number(value, 100000);
            } else if (section == "security" && key == "max_frames_per_second") {
                settings.network.security.max_frames_per_second = positive_number(value, 100000);
            } else if (section == "security" && key == "max_invalid_frames") {
                settings.network.security.max_invalid_frames = positive_number(value, 65535);
            } else if (section == "security" && key == "max_pending_logins") {
                settings.network.security.max_pending_logins = positive_number(value, 65535);
            } else if (section == "security" && key == "max_pending_per_ip") {
                settings.network.security.max_pending_per_ip = positive_number(value, 65535);
            } else if (section == "security" && key == "max_login_bytes") {
                settings.network.security.max_login_bytes = positive_number(value, 16777216);
            } else if (section == "security" && key == "max_login_frames") {
                settings.network.security.max_login_frames = positive_number(value, 65535);
            } else if (section == "security" && key == "max_identity_checks_per_minute") {
                settings.network.security.max_identity_checks_per_minute = positive_number(value, 100000);
            } else if (section == "security" && key == "max_identity_checks_per_second") {
                settings.network.security.max_identity_checks_per_second = positive_number(value, 100000);
            } else if (section == "security" && key == "tls_handshake_timeout") {
                settings.network.security.tls_handshake_timeout = std::chrono::seconds(positive_number(value, 3600));
            } else if (section == "security" && key == "partial_frame_timeout") {
                settings.network.security.partial_frame_timeout = std::chrono::seconds(positive_number(value, 3600));
            } else if (section == "security" && key == "login_timeout") {
                settings.network.security.login_timeout = std::chrono::seconds(positive_number(value, 3600));
            } else if (section == "security" && key == "output_timeout") {
                settings.network.security.output_timeout = std::chrono::seconds(positive_number(value, 3600));
            } else if (section == "security" && key == "close_timeout") {
                settings.network.security.close_timeout = std::chrono::seconds(positive_number(value, 3600));
            } else if (section == "tls" && key == "certificate") {
                settings.network.tls_certificate = resolve_path(value, path.parent_path());
            } else if (section == "tls" && key == "private_key") {
                settings.network.tls_private_key = resolve_path(value, path.parent_path());
            } else if (section == "logging" && key == "level") {
                settings.logging.level = level(value);
            } else if (section == "logging" && key == "file") {
                settings.logging.file_path = value == "stderr" ? "" : resolve_path(value, path.parent_path());
            } else if (section == "logging" && key == "chat") {
                settings.logging.chat = connection_logging(value);
            } else if (section == "logging" && key == "connections") {
                settings.logging.connections = connection_logging(value);
            } else if (section == "api" && key == "enabled") {
                settings.api.enabled = connection_logging(value);
            } else if (section == "api" && key == "socket") {
                settings.api.socket_path = resolve_path(value, path.parent_path());
            } else if (section == "api" && key == "token_file") {
                settings.api.token_file = resolve_path(value, path.parent_path());
            } else if (section == "api" && key == "max_connections") {
                settings.api.max_connections = positive_number(value, 128);
            } else if (section == "api" && key == "request_timeout") {
                settings.api.request_timeout = positive_number(value, 30);
            } else if (section == "authentication" && key == "enabled") {
                settings.authentication.enabled = connection_logging(value);
            } else if (section == "authentication" && key == "key_file") {
                settings.authentication.key_file = resolve_path(value,path.parent_path());
            } else if (section == "authentication" && key == "max_accounts") {
                settings.authentication.max_accounts = positive_number(value,4096);
            } else if (section == "authentication" && key == "attempts_per_ip") {
                settings.network.authentication_limits.attempts_per_ip = positive_number(value,100000);
            } else if (section == "authentication" && key == "attempts_per_account") {
                settings.network.authentication_limits.attempts_per_account = positive_number(value,100000);
            } else if (section == "authentication" && key == "attempts_per_second") {
                settings.network.authentication_limits.attempts_per_second = positive_number(value,100000);
            } else if (section == "authentication" && key == "attempt_window_seconds") {
                settings.network.authentication_limits.window = std::chrono::seconds(positive_number(value,3600));
            } else if (section == "authentication" && key == "max_tracked_attempt_ips") {
                settings.network.authentication_limits.max_tracked_ips = positive_number(value,65536);
            } else if (section == "authentication" && key == "max_tracked_attempt_accounts") {
                settings.network.authentication_limits.max_tracked_accounts = positive_number(value,65536);
            } else if (section == "authentication" && key == "require_tls") {
                settings.authentication.require_tls = connection_logging(value);
            } else if (section == "database" && key == "enabled") {
                settings.database.enabled = connection_logging(value);
            } else if (section == "database" && key == "socket") {
                settings.database.socket = value.empty() ? "" : resolve_path(value, path.parent_path());
            } else if (section == "database" && key == "name") {
                settings.database.name = value;
            } else if (section == "database" && key == "user") {
                settings.database.user = value;
            } else if (section == "database" && key == "password_file") {
                settings.database.password_file = resolve_path(value, path.parent_path());
            } else if (section == "database" && key == "timeout") {
                settings.database.timeout = positive_number(value, 60);
            } else if (section == "database" && key == "connect_timeout") {
                settings.database.connect_timeout = positive_number(value, 60);
            } else if (section == "database" && key == "read_timeout") {
                settings.database.read_timeout = positive_number(value, 60);
            } else if (section == "database" && key == "write_timeout") {
                settings.database.write_timeout = positive_number(value, 60);
            } else if (section == "roles" && key == "vip_permissions") {
                settings.network.roles=security::parse_vip_permissions(value);
            } else if (section == "general" && key == "language") {
                settings.logging.language = i18n::parse_language(value);
            } else { throw std::invalid_argument("Unknown configuration key"); }
        } catch (const std::invalid_argument&) {
            throw std::invalid_argument("Invalid or unknown configuration key/value at line " + std::to_string(line_number));
        }
    }
    return settings; // Cross-field validation follows CLI overrides.
}
} // namespace

Settings load_file(const std::string& filename) {
    return parse_file_data(filename, read_file(filename));
}

namespace {
ReviewOptions review_options(const Settings& settings) {
    const auto log_level = [&] {
        switch (settings.logging.level) {
        case logging::Level::info: return "info";
        case logging::Level::warning: return "warning";
        case logging::Level::error: return "error";
        case logging::Level::off: return "off";
        }
        throw std::invalid_argument("Invalid logging level");
    }();
    return {{{"network_max_connections", std::to_string(settings.network.max_connections)},
             {"network_idle_timeout", std::to_string(settings.network.idle_timeout.count())},
             {"logging_level", log_level},
             {"general_language", settings.logging.language == i18n::Language::pl ? "pl" : "us"}}};
}

bool apply_review_change(Settings& settings, std::string_view key, std::string_view value) {
    try {
        if (key == "network_max_connections") {
            settings.network.max_connections = positive_number(value, 65535);
        } else if (key == "network_idle_timeout") {
            settings.network.idle_timeout = std::chrono::seconds(positive_number(value, 86400));
        } else if (key == "logging_level") {
            settings.logging.level = level(value);
        } else if (key == "general_language") {
            if (value != "us" && value != "pl") { return false; }
            settings.logging.language = value == "pl" ? i18n::Language::pl : i18n::Language::us;
        } else {
            throw std::invalid_argument("Unknown review option");
        }
    } catch (const std::invalid_argument&) {
        // Unknown keys are rejected at the HTTP boundary. Bad values are a
        // validation result, not an invitation to reveal the INI parser error.
        return false;
    }
    return true;
}
} // namespace

Review::Review(const Settings& active)
    : filename_(active.source_file), active_(review_options(active)) {
    if (filename_.empty()) { throw std::invalid_argument("Configuration review needs --config"); }
    validate(active);
    if (RAND_bytes(revision_key_.data(), static_cast<int>(revision_key_.size())) != 1) {
        throw std::runtime_error("Cannot initialize configuration revision");
    }
}

Review::~Review() { OPENSSL_cleanse(revision_key_.data(), revision_key_.size()); }

std::string Review::revision_for(std::string_view file) const {
    unsigned char digest[EVP_MAX_MD_SIZE]{};
    unsigned int length{};
    const auto* bytes = HMAC(EVP_sha256(), revision_key_.data(), static_cast<int>(revision_key_.size()),
        reinterpret_cast<const unsigned char*>(file.data()), file.size(), digest, &length);
    if (!bytes || length != 32) { throw std::runtime_error("Cannot compute configuration revision"); }
    constexpr char hex[] = "0123456789abcdef";
    std::string result(64, '0');
    for (std::size_t i = 0; i < 32; ++i) {
        result[2 * i] = hex[digest[i] >> 4];
        result[2 * i + 1] = hex[digest[i] & 0x0f];
    }
    OPENSSL_cleanse(digest, sizeof(digest));
    return result;
}

ReviewSnapshot Review::read() const {
    const auto data = read_file(filename_);
    const auto saved_settings = parse_file_data(filename_, data);
    validate(saved_settings);
    ReviewSnapshot result;
    result.revision = revision_for(data);
    result.saved = review_options(saved_settings);
    result.active = active_;
    result.matches_active = true;
    for (std::size_t i = 0; i < result.saved.size(); ++i) {
        if (result.saved[i].value != result.active[i].value) { result.matches_active = false; }
    }
    return result;
}

namespace {
std::string patch_ini(std::string source, const std::vector<std::pair<std::string, std::string>>& changes);
}

bool Review::validate_candidate(std::string_view revision,
    const std::vector<std::pair<std::string, std::string>>& changes) const {
    if (changes.empty() || changes.size() > 4) { throw std::invalid_argument("Invalid review change set"); }
    for (std::size_t i = 0; i < changes.size(); ++i) {
        for (std::size_t j = 0; j < i; ++j) {
            if (changes[i].first == changes[j].first) { throw std::invalid_argument("Duplicate review option"); }
        }
    }
    const auto data = read_file(filename_);
    if (revision_for(data) != revision) { throw StaleReview(); }
    auto candidate = parse_file_data(filename_, data);
    validate(candidate); // Reject an already invalid saved file.
    for (const auto& [key, value] : changes) {
        if (!apply_review_change(candidate, key, value)) { return false; }
    }
    try {
        validate(candidate);
        // Preview the actual INI bytes: a valid setting may still overflow the
        // 64 KiB file or line limit when a missing key must be inserted.
        validate(parse_file_data(filename_, patch_ini(data, changes)));
    } catch (const std::invalid_argument&) {
        return false;
    }
    return true;
}

namespace {
struct OwnedFd {
    int fd{-1};
    explicit OwnedFd(int value) noexcept : fd(value) {}
    ~OwnedFd() { if (fd >= 0) { (void)::close(fd); } }
    OwnedFd(const OwnedFd&) = delete;
    OwnedFd& operator=(const OwnedFd&) = delete;
};

[[noreturn]] void unsafe_file() { throw std::invalid_argument("Unsafe configuration storage"); }
void checked_regular(const struct stat& state, bool secret) {
    if (!S_ISREG(state.st_mode) || state.st_nlink != 1 || state.st_uid != ::geteuid() ||
        (state.st_mode & (secret ? 0077 : 0022)) != 0 || state.st_size < 0 ||
        static_cast<std::uintmax_t>(state.st_size) > max_file_bytes) { unsafe_file(); }
}
bool unchanged(const struct stat& a, const struct stat& b) noexcept {
    return a.st_dev == b.st_dev && a.st_ino == b.st_ino && a.st_size == b.st_size &&
        a.st_mode == b.st_mode && a.st_uid == b.st_uid &&
        a.st_mtim.tv_sec == b.st_mtim.tv_sec && a.st_mtim.tv_nsec == b.st_mtim.tv_nsec &&
        a.st_ctim.tv_sec == b.st_ctim.tv_sec && a.st_ctim.tv_nsec == b.st_ctim.tv_nsec;
}
struct FileBytes { std::string text; struct stat state{}; };

class LockedConfig final {
public:
    explicit LockedConfig(const std::string& filename)
        : leaf_(fs::path(filename).filename().string()),
          directory_(::open((fs::path(filename).has_parent_path() ? fs::path(filename).parent_path() : fs::path(".")).c_str(),
              O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)),
          lock_(-1) {
        if (leaf_.empty() || leaf_.size() > 180 || leaf_ == "." || leaf_ == ".." || directory_.fd < 0) { unsafe_file(); }
        struct stat directory_state{};
        if (::fstat(directory_.fd, &directory_state) != 0 || !S_ISDIR(directory_state.st_mode) ||
            directory_state.st_uid != ::geteuid() || (directory_state.st_mode & 0022) != 0) { unsafe_file(); }
        lock_.fd = ::openat(directory_.fd, ("." + leaf_ + ".dc24h.lock").c_str(),
            O_RDWR | O_CREAT | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC, 0600);
        struct stat lock_state{};
        if (lock_.fd < 0 || ::fstat(lock_.fd, &lock_state) != 0) { unsafe_file(); }
        checked_regular(lock_state, true);
        if ((lock_state.st_mode & 0777) != 0600 || ::flock(lock_.fd, LOCK_EX | LOCK_NB) != 0) { unsafe_file(); }
    }
    [[nodiscard]] FileBytes primary() const { return load(leaf_, false); }
    [[nodiscard]] FileBytes backup() const { return load(leaf_ + ".dc24h.bak", true); }
    void check_primary(const struct stat& expected) const {
        struct stat actual{};
        if (::fstatat(directory_.fd, leaf_.c_str(), &actual, AT_SYMLINK_NOFOLLOW) != 0 || !unchanged(expected, actual)) {
            throw StaleReview();
        }
    }
    void persist_backup(std::string_view bytes) const { persist(leaf_ + ".dc24h.bak", bytes, 0600); }
    void persist_undo(std::string_view bytes) const { persist(leaf_ + ".dc24h.undo", bytes, 0600); }
    void persist_primary(std::string_view bytes, mode_t mode) const { persist(leaf_, bytes, mode & 0777); }
private:
    std::string leaf_;
    OwnedFd directory_;
    OwnedFd lock_;

    [[nodiscard]] FileBytes load(const std::string& name, bool secret) const {
        OwnedFd file(::openat(directory_.fd, name.c_str(), O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC));
        if (file.fd < 0) { unsafe_file(); }
        FileBytes result;
        if (::fstat(file.fd, &result.state) != 0) { unsafe_file(); }
        checked_regular(result.state, secret);
        result.text = read_fd(file.fd);
        struct stat after{};
        if (::fstat(file.fd, &after) != 0 || !unchanged(result.state, after)) { throw StaleReview(); }
        return result;
    }
    void persist(const std::string& name, std::string_view bytes, mode_t mode) const {
        if (bytes.size() > max_file_bytes) { unsafe_file(); }
        struct stat previous{};
        if (::fstatat(directory_.fd, name.c_str(), &previous, AT_SYMLINK_NOFOLLOW) == 0) {
            checked_regular(previous, name != leaf_);
        } else if (errno != ENOENT) { unsafe_file(); }
        std::array<unsigned char, 12> random{};
        if (RAND_bytes(random.data(), static_cast<int>(random.size())) != 1) { unsafe_file(); }
        constexpr char hex[] = "0123456789abcdef";
        std::string temporary = "." + leaf_ + ".tmp-";
        for (const auto byte : random) { temporary += hex[byte >> 4]; temporary += hex[byte & 15]; }
        OwnedFd fd(::openat(directory_.fd, temporary.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600));
        if (fd.fd < 0) { unsafe_file(); }
        bool renamed = false;
        try {
            if (::fchmod(fd.fd, mode) != 0) { unsafe_file(); }
            std::size_t offset = 0;
            while (offset < bytes.size()) {
                const auto count = ::write(fd.fd, bytes.data() + offset, bytes.size() - offset);
                if (count < 0 && errno == EINTR) { continue; }
                if (count <= 0) { unsafe_file(); }
                offset += static_cast<std::size_t>(count);
            }
            if (::fsync(fd.fd) != 0 || ::renameat(directory_.fd, temporary.c_str(), directory_.fd, name.c_str()) != 0) {
                unsafe_file();
            }
            renamed = true;
            if (::fsync(directory_.fd) != 0) { throw WriteOutcomeUnknown(); }
        } catch (...) {
            if (!renamed) { (void)::unlinkat(directory_.fd, temporary.c_str(), 0); }
            throw;
        }
    }
};

struct IniField { const char* section; const char* key; };
IniField ini_field(std::string_view key) {
    if (key == "network_max_connections") { return {"network", "max_connections"}; }
    if (key == "network_idle_timeout") { return {"network", "idle_timeout"}; }
    if (key == "logging_level") { return {"logging", "level"}; }
    if (key == "general_language") { return {"general", "language"}; }
    throw std::invalid_argument("Unknown review option");
}
std::string patch_ini(std::string source, const std::vector<std::pair<std::string, std::string>>& changes) {
    for (const auto& [name, value] : changes) {
        const auto target = ini_field(name);
        std::string section;
        bool found = false;
        std::size_t pos = 0;
        while (pos < source.size()) {
            const auto end = source.find('\n', pos);
            const auto line_end = end == std::string::npos ? source.size() : end;
            std::string_view line(source.data() + pos, line_end - pos);
            const bool cr = !line.empty() && line.back() == '\r';
            if (cr) { line.remove_suffix(1); }
            if (pos == 0 && line.starts_with("\xEF\xBB\xBF")) { line.remove_prefix(3); }
            const auto text = trim(line);
            if (text.size() >= 3 && text.front() == '[' && text.back() == ']') {
                section = trim(std::string_view(text).substr(1, text.size() - 2));
            } else if (section == target.section) {
                const auto equal = text.find('=');
                if (equal != std::string::npos && trim(std::string_view(text).substr(0, equal)) == target.key) {
                    source.replace(pos, line_end - pos, std::string(target.key) + " = " + value + (cr ? "\r" : ""));
                    found = true;
                    break;
                }
            }
            if (end == std::string::npos) { break; }
            pos = end + 1;
        }
        if (!found) {
            if (!source.empty() && source.back() != '\n') { source += '\n'; }
            source += std::string("[") + target.section + "]\n" + target.key + " = " + value + "\n";
        }
        if (source.size() > max_file_bytes) { throw std::invalid_argument("Configuration exceeds size limit"); }
    }
    return source;
}
} // namespace

std::string Review::write_candidate(std::string_view revision,
    const std::vector<std::pair<std::string, std::string>>& changes) const {
    if (changes.empty() || changes.size() > 4) { throw std::invalid_argument("Invalid change set"); }
    std::map<std::string, std::string> unique;
    for (const auto& [key, value] : changes) {
        (void)ini_field(key);
        if (!unique.emplace(key, value).second) { throw std::invalid_argument("Duplicate change"); }
    }
    LockedConfig storage(filename_);
    const auto current = storage.primary();
    if (revision_for(current.text) != revision) { throw StaleReview(); }
    auto candidate = parse_file_data(filename_, current.text);
    validate(candidate);
    for (const auto& [key, value] : changes) {
        if (!apply_review_change(candidate, key, value)) { throw std::invalid_argument("Invalid proposed setting"); }
    }
    validate(candidate);
    const auto updated = patch_ini(current.text, changes);
    validate(parse_file_data(filename_, updated));
    storage.check_primary(current.state);
    storage.persist_backup(current.text);
    storage.check_primary(current.state);
    storage.persist_primary(updated, current.state.st_mode);
    return revision_for(updated);
}

std::string Review::restore_backup(std::string_view revision) const {
    LockedConfig storage(filename_);
    const auto current = storage.primary();
    if (revision_for(current.text) != revision) { throw StaleReview(); }
    const auto backup = storage.backup();
    validate(parse_file_data(filename_, backup.text));
    // A no-op restore would overwrite the only undo copy with the already
    // restored bytes, preventing recovery of the previous configuration.
    if (backup.text == current.text) { throw StaleReview(); }
    storage.check_primary(current.state);
    storage.persist_undo(current.text);
    storage.check_primary(current.state);
    storage.persist_primary(backup.text, current.state.st_mode);
    return revision_for(backup.text);
}

CommandLine parse_arguments(int argc, char* const argv[]) {
    CommandLine result;
    std::string filename;
    bool has_config = false;
    bool operational = false;
    for (int i = 1; i < argc; ++i) {
        const std::string_view key(argv[i]);
        if (key == "--help") { result.show_help = true; continue; }
        if (key == "--version") { result.show_version = true; continue; }
        if (key == "--check-config" || key == "--check-database" || key == "--migrate-database" || key == "--database-status" || key == "--show-configuration") { operational = true; continue; }
        if (key == "--config") {
            if (has_config || i + 1 == argc) {
                throw std::invalid_argument("Provide --config only once with a file");
            }
            filename = argv[++i]; has_config = true; operational = true; continue;
        }
        if (key == "--listen" || key == "--adcs-listen" || key == "--tls-cert" || key == "--tls-key" ||
            key == "--max-connections" || key == "--max-sessions" || key == "--max-users" || key == "--idle-timeout" || key == "--log-file" ||
            key == "--log-level" || key == "--log-chat" || key == "--log-connections" || key == "--language" ||
            key == "--max-per-ip" || key == "--accepts-per-minute" || key == "--frames-per-second" ||
            key == "--max-invalid-frames" || key == "--tls-handshake-timeout" || key == "--partial-frame-timeout" ||
            key == "--backup-database" || key == "--restore-database") {
            if (i + 1 == argc) { throw std::invalid_argument("Missing option value"); }
            if (key != "--language") { operational = true; }
            ++i; continue;
        }
        throw std::invalid_argument("Unknown option");
    }
    if ((result.show_help || result.show_version) && (operational || (result.show_help && result.show_version))) {
        throw std::invalid_argument("Help/version cannot be combined with operational options");
    }
    if (has_config) { result.settings = load_file(filename); }
    ListenerList plain, tls;
    for (int i = 1; i < argc; ++i) {
        const std::string_view key(argv[i]);
        if (key == "--config") { ++i; continue; }
        if (key == "--check-config") { result.check_only = true; continue; }
        if (key == "--check-database") { result.check_database = true; continue; }
        if (key == "--migrate-database") { result.migrate_database = true; continue; }
        if (key == "--database-status") { result.database_status = true; continue; }
        if (key == "--show-configuration") { result.show_configuration = true; continue; }
        if (key == "--help" || key == "--version") { continue; }
        const std::string_view value(argv[++i]);
        if (key == "--listen") { plain.add(result.settings, result.settings.network.listeners, value); }
        else if (key == "--adcs-listen") { tls.add(result.settings, result.settings.network.tls_listeners, value); }
        else if (key == "--tls-cert") {
            path_text(value); result.settings.network.tls_certificate = value;
        } else if (key == "--tls-key") {
            path_text(value); result.settings.network.tls_private_key = value;
        } else if (key == "--max-connections") {
            result.settings.network.max_connections = positive_number(value, 65535);
        } else if (key == "--max-sessions") {
            result.settings.network.users.max_sessions = positive_number(value, 65535);
        } else if (key == "--max-users") {
            result.settings.network.users.max_users = positive_number(value, 65535);
        } else if (key == "--idle-timeout") {
            result.settings.network.idle_timeout = std::chrono::seconds(positive_number(value, 86400));
        } else if (key == "--max-per-ip") {
            result.settings.network.security.max_connections_per_ip = positive_number(value, 65535);
        } else if (key == "--accepts-per-minute") {
            result.settings.network.security.max_accepts_per_minute = positive_number(value, 100000);
        } else if (key == "--frames-per-second") {
            result.settings.network.security.max_frames_per_second = positive_number(value, 100000);
        } else if (key == "--max-invalid-frames") {
            result.settings.network.security.max_invalid_frames = positive_number(value, 65535);
        } else if (key == "--tls-handshake-timeout") {
            result.settings.network.security.tls_handshake_timeout = std::chrono::seconds(positive_number(value, 3600));
        } else if (key == "--partial-frame-timeout") {
            result.settings.network.security.partial_frame_timeout = std::chrono::seconds(positive_number(value, 3600));
        } else if (key == "--log-level") { result.settings.logging.level = level(value); }
        else if (key == "--log-chat") { result.settings.logging.chat = connection_logging(value); }
        else if (key == "--log-connections") { result.settings.logging.connections = connection_logging(value); }
        else if (key == "--log-file") {
            path_text(value); result.settings.logging.file_path = value == "-" ? "" : std::string(value);
        } else if (key == "--language") { result.settings.logging.language = i18n::parse_language(value); }
        else if (key == "--backup-database") {
            if (!result.backup_database.empty()) { throw std::invalid_argument("Provide --backup-database only once"); }
            path_text(value); result.backup_database = std::string(value);
        } else if (key == "--restore-database") {
            if (!result.restore_database.empty()) { throw std::invalid_argument("Provide --restore-database only once"); }
            path_text(value); result.restore_database = std::string(value);
        }
    }
    if (static_cast<int>(result.check_only) + static_cast<int>(result.check_database) +
        static_cast<int>(result.migrate_database) + static_cast<int>(result.database_status) + static_cast<int>(result.show_configuration) +
        static_cast<int>(!result.backup_database.empty()) + static_cast<int>(!result.restore_database.empty()) > 1) {
        throw std::invalid_argument("Database actions and configuration check are mutually exclusive");
    }
    if ((result.check_database || result.migrate_database || result.database_status ||
         !result.backup_database.empty() || !result.restore_database.empty()) && !result.settings.database.enabled) {
        throw std::invalid_argument("Database is disabled");
    }
    validate(result.settings);
    return result;
}
} // namespace dc24h::configuration
