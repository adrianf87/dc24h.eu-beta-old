// Read-only local systemd controller. No hub process, shell, or service action.
#include "dc24h/version.hpp"
#include <algorithm>
#include <cerrno>
#include <chrono>
#include <csignal>
#include <cstring>
#include <filesystem>
#include <iostream>
#include <limits>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <poll.h>
#include <fcntl.h>
#include <unistd.h>

namespace {
volatile std::sig_atomic_t stopping=0;
void request_stop(int) { stopping=1; }

struct Fd {
    int value{-1};
    explicit Fd(int fd=-1):value(fd){}
    ~Fd(){if(value>=0) (void)::close(value);}
    Fd(const Fd&)=delete;
    Fd& operator=(const Fd&)=delete;
};

// The only subprocess is a fixed, read-only query. Never accept command or
// unit names from the socket, environment or CLI.
std::string query_systemd() {
    int pipes[2];
    if(::pipe2(pipes,O_CLOEXEC)!=0)return {};
    Fd read_end(pipes[0]);
    Fd write_end(pipes[1]);
    const pid_t pid=::fork();
    if(pid<0)return {};
    if(pid==0) {
        (void)::dup2(write_end.value,STDOUT_FILENO);
        const int null_fd=::open("/dev/null",O_WRONLY|O_CLOEXEC);
        if(null_fd>=0){(void)::dup2(null_fd,STDERR_FILENO);(void)::close(null_fd);}
        (void)::close(read_end.value);
        (void)::close(write_end.value);
        const char* const args[]={"systemctl","--system","--no-pager","show",
            "--property=LoadState,ActiveState,SubState,Result,MainPID","dc24h.service",nullptr};
        const char* const env[]={"PATH=/usr/bin:/bin","LANG=C","SYSTEMD_COLORS=0",nullptr};
        ::execve("/usr/bin/systemctl",const_cast<char* const*>(args),const_cast<char* const*>(env));
        ::_exit(127);
    }
    (void)::close(write_end.value);
    write_end.value=-1;
    std::string output;
    bool complete=false;
    // Bounded time and output; no invocation can block the controller forever.
    const auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(2);
    while(std::chrono::steady_clock::now()<deadline && output.size()<4096) {
        struct pollfd pfd{read_end.value,POLLIN,0};
        const auto remaining=std::chrono::duration_cast<std::chrono::milliseconds>(deadline-std::chrono::steady_clock::now()).count();
        const int ready=::poll(&pfd,1,static_cast<int>(std::max(0L,remaining)));
        if(ready<0){if(errno==EINTR)continue;break;}
        if(ready==0)break;
        char buffer[512];
        const auto count=::read(read_end.value,buffer,sizeof(buffer));
        if(count==0){complete=true;break;}
        if(count<0){if(errno==EINTR)continue;break;}
        output.append(buffer,static_cast<std::size_t>(count));
    }
    int status=0;
    bool exited=false;
    if(complete) {
        // EOF does not guarantee the process has exited: do not block waitpid.
        while(std::chrono::steady_clock::now()<deadline) {
            const auto waited=::waitpid(pid,&status,WNOHANG);
            if(waited==pid){exited=true;break;}
            if(waited<0&&errno!=EINTR)break;
            (void)::usleep(10000);
        }
    }
    if(!exited) {
        (void)::kill(pid,SIGKILL);
        while(::waitpid(pid,&status,0)<0&&errno==EINTR){}
        return {};
    }
    if(!WIFEXITED(status)||WEXITSTATUS(status)!=0)return {};
    return output;
}

std::string field(std::string_view source,std::string_view key) {
    const auto marker=std::string(key)+"=";
    auto position=source.find(marker);
    if(position!=0 && (position==std::string_view::npos || source[position-1]!='\n'))return "unknown";
    position+=marker.size();
    const auto end=source.find('\n',position);
    const auto value=source.substr(position,end==std::string_view::npos?end:end-position);
    if(value.empty()||value.size()>48)return "unknown";
    for(const unsigned char c:value)if(!((c>='a'&&c<='z')||c=='-'))return "unknown";
    return std::string(value);
}

std::string status_json() {
    const auto output=query_systemd();
    if(output.empty())return "{\"schema\":1,\"available\":false,\"error\":\"systemd_unavailable\"}\n";
    const auto load=field(output,"LoadState");
    const auto active=field(output,"ActiveState");
    const auto sub=field(output,"SubState");
    const auto result=field(output,"Result");
    if(load=="unknown"||active=="unknown")return "{\"schema\":1,\"available\":false,\"error\":\"invalid_systemd_response\"}\n";
    return "{\"schema\":1,\"available\":true,\"unit\":\"dc24h.service\",\"load_state\":\""+load+
        "\",\"active_state\":\""+active+"\",\"sub_state\":\""+sub+"\",\"result\":\""+result+"\"}\n";
}

// SOCK_STREAM may split one command across reads. Read through its newline
// under a single deadline, without accepting trailing bytes or unbounded input.
std::optional<std::string> read_command(int fd) {
    std::string command;
    const auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(2);
    while(command.size()<32 && std::chrono::steady_clock::now()<deadline) {
        struct pollfd pfd{fd,POLLIN,0};
        const auto remaining=std::chrono::duration_cast<std::chrono::milliseconds>(deadline-std::chrono::steady_clock::now()).count();
        const int ready=::poll(&pfd,1,static_cast<int>(std::max(0L,remaining)));
        if(ready<0){if(errno==EINTR)continue;return std::nullopt;}
        if(ready==0)return std::string{};
        char bytes[32];
        const auto count=::recv(fd,bytes,sizeof(bytes)-command.size(),MSG_DONTWAIT);
        if(count<0){if(errno==EINTR||errno==EAGAIN)continue;return std::nullopt;}
        if(count==0)return std::nullopt;
        command.append(bytes,static_cast<std::size_t>(count));
        const auto newline=command.find('\n');
        if(newline!=std::string::npos) {
            if(newline+1!=command.size())return std::string{};
            char extra{};
            if(::recv(fd,&extra,1,MSG_PEEK|MSG_DONTWAIT)>0)return std::string{};
            return command;
        }
    }
    return std::string{};
}

void serve_peer(int connection) {
    Fd peer(connection);
    struct ucred credentials{};
    socklen_t length=sizeof(credentials);
    if(::getsockopt(peer.value,SOL_SOCKET,SO_PEERCRED,&credentials,&length)!=0||length!=sizeof(credentials))return;
    // Credential check is in addition to the private Unix socket filesystem
    // boundary. Only the controller's UID or its configured primary group.
    if(credentials.uid!=::geteuid()&&credentials.gid!=::getegid())return;
    const struct timeval timeout{2,0};
    (void)::setsockopt(peer.value,SOL_SOCKET,SO_RCVTIMEO,&timeout,sizeof(timeout));
    (void)::setsockopt(peer.value,SOL_SOCKET,SO_SNDTIMEO,&timeout,sizeof(timeout));
    const auto command=read_command(peer.value);
    if(!command)return;
    const std::string response=(*command=="STATUS\n")
        ?status_json():"{\"error\":\"unsupported_request\"}\n";
    (void)::send(peer.value,response.data(),response.size(),MSG_NOSIGNAL);
}

bool safe_parent(const std::filesystem::path& path) {
    Fd dir(::open(path.c_str(),O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW));
    struct stat info{};
    return dir.value>=0&&::fstat(dir.value,&info)==0&&S_ISDIR(info.st_mode)&&
        info.st_uid==::geteuid()&&(info.st_mode&0022)==0;
}

int run(std::string_view pathname) {
    if(pathname.empty()||pathname.size()>=sizeof(sockaddr_un::sun_path)||pathname[0]!='/'||
       pathname.find("/../")!=std::string_view::npos||pathname.ends_with("/.."))
        throw std::runtime_error("Invalid socket path");
    const std::filesystem::path path(pathname);
    if(path.filename().empty()||!safe_parent(path.parent_path()))
        throw std::runtime_error("Socket parent must be a private, owner-controlled directory");
    struct stat previous{};
    const bool exists=::lstat(path.c_str(),&previous)==0;
    if(exists&&(!S_ISSOCK(previous.st_mode)||previous.st_uid!=::geteuid()))
        throw std::runtime_error("Refusing to replace unsafe socket path");
    if(!exists&&errno!=ENOENT)throw std::runtime_error("Cannot inspect socket");
    Fd listener(::socket(AF_UNIX,SOCK_STREAM|SOCK_CLOEXEC,0));
    if(listener.value<0)throw std::runtime_error("Cannot open socket");
    if(exists) {
        Fd probe(::socket(AF_UNIX,SOCK_STREAM|SOCK_CLOEXEC,0));
        sockaddr_un address{};address.sun_family=AF_UNIX;
        std::strncpy(address.sun_path,path.c_str(),sizeof(address.sun_path)-1);
        if(probe.value<0)throw std::runtime_error("Cannot probe existing controller socket");
        if(::connect(probe.value,reinterpret_cast<sockaddr*>(&address),sizeof(address))==0)
            throw std::runtime_error("Controller already running");
        // Only ECONNREFUSED establishes that the socket has no listener.
        // EACCES, EINTR and resource failures must never remove a live socket.
        if(errno!=ECONNREFUSED)throw std::runtime_error("Cannot verify stale controller socket");
        if(::unlink(path.c_str())!=0)throw std::runtime_error("Cannot clear stale socket");
    }
    sockaddr_un address{};address.sun_family=AF_UNIX;
    std::strncpy(address.sun_path,path.c_str(),sizeof(address.sun_path)-1);
    const mode_t old_mask=::umask(0077);
    const int bound=::bind(listener.value,reinterpret_cast<sockaddr*>(&address),sizeof(address));
    ::umask(old_mask);
    if(bound!=0)throw std::runtime_error("Cannot bind controller socket");
    struct stat bound_info{};
    if(::lstat(path.c_str(),&bound_info)!=0)throw std::runtime_error("Cannot inspect bound socket");
    // Allow only the service's designated Unix group, never the world.
    if(::chmod(path.c_str(),0660)!=0)throw std::runtime_error("Cannot set socket permissions");
    if(::listen(listener.value,16)!=0)throw std::runtime_error("Cannot listen");
    std::signal(SIGTERM,request_stop);
    std::signal(SIGINT,request_stop);
    while(!stopping) {
        struct pollfd event{listener.value,POLLIN,0};
        const int ready=::poll(&event,1,500);
        if(ready<0){if(errno==EINTR)continue;break;}
        if(ready==0)continue;
        const int peer=::accept4(listener.value,nullptr,nullptr,SOCK_CLOEXEC);
        if(peer>=0)serve_peer(peer);
        else if(errno!=EINTR)break;
    }
    struct stat current{};
    if(::lstat(path.c_str(),&current)==0&&current.st_ino==bound_info.st_ino&&current.st_dev==bound_info.st_dev)
        (void)::unlink(path.c_str());
    return 0;
}
}

int main(int argc,char** argv) {
    if(argc==2&&std::string_view(argv[1])=="--version"){
        std::cout<<"dc24h-service-controller "<<dc24h::version<<'\n';return 0;
    }
    if(argc!=3||std::string_view(argv[1])!="--socket"){
        std::cerr<<"Usage: dc24h-service-controller --socket /run/dc24h-control/status.sock\n";return 2;
    }
    try { return run(argv[2]); }
    catch(const std::exception& error){std::cerr<<"Controller startup failed: "<<error.what()<<'\n';return 1;}
}
