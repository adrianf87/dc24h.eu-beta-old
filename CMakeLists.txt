cmake_minimum_required(VERSION 3.22)
project(dc24h VERSION 0.1.0 LANGUAGES CXX)

if(NOT CMAKE_SYSTEM_NAME STREQUAL "Linux")
    message(FATAL_ERROR "dc24h currently targets Linux (Debian / Ubuntu).")
endif()

# One sanitizer per build directory. AddressSanitizer and ThreadSanitizer cannot
# share a binary. Empty is the normal Debug or Release build.
set(DC24H_SANITIZER "" CACHE STRING
    "One sanitizer for this build: address, undefined, or thread. Empty leaves the build uninstrumented.")
if(DC24H_SANITIZER STREQUAL "")
elseif(DC24H_SANITIZER STREQUAL "address")
    add_compile_options(-fsanitize=address -fno-omit-frame-pointer -fno-sanitize-recover=address)
    add_link_options(-fsanitize=address)
    add_compile_definitions(DC24H_SANITIZE_ADDRESS=1)
elseif(DC24H_SANITIZER STREQUAL "undefined")
    add_compile_options(-fsanitize=undefined -fno-omit-frame-pointer -fno-sanitize-recover=undefined)
    add_link_options(-fsanitize=undefined)
    add_compile_definitions(DC24H_SANITIZE_UNDEFINED=1)
elseif(DC24H_SANITIZER STREQUAL "thread")
    add_compile_options(-fsanitize=thread -fno-omit-frame-pointer -fno-sanitize-recover=thread)
    add_link_options(-fsanitize=thread)
    add_compile_definitions(DC24H_SANITIZE_THREAD=1)
else()
    message(FATAL_ERROR "DC24H_SANITIZER must be address, undefined, thread, or empty")
endif()

# The VERSION tuple above is the package number; operators see the beta version.
set(DC24H_VERSION "beta-0.4.8")
configure_file(cmake/version.hpp.in generated/dc24h/version.hpp @ONLY)
find_package(Threads REQUIRED)
find_package(OpenSSL 3 REQUIRED COMPONENTS SSL Crypto)

add_library(dc24h_i18n src/i18n/messages.cpp)
target_compile_features(dc24h_i18n PUBLIC cxx_std_20)
set_target_properties(dc24h_i18n PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_i18n PUBLIC include PRIVATE languages)

add_library(dc24h_logging src/logging/logger.cpp)
target_compile_features(dc24h_logging PUBLIC cxx_std_20)
set_target_properties(dc24h_logging PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_logging PUBLIC include)
target_link_libraries(dc24h_logging PUBLIC Threads::Threads dc24h_i18n)

find_path(UTF8PROC_INCLUDE_DIR NAMES utf8proc.h REQUIRED)
find_library(UTF8PROC_LIBRARY NAMES utf8proc REQUIRED)
add_library(UTF8Proc::UTF8Proc UNKNOWN IMPORTED)
set_target_properties(UTF8Proc::UTF8Proc PROPERTIES
    IMPORTED_LOCATION "${UTF8PROC_LIBRARY}"
    INTERFACE_INCLUDE_DIRECTORIES "${UTF8PROC_INCLUDE_DIR}")
target_link_libraries(dc24h_logging PRIVATE UTF8Proc::UTF8Proc)
find_path(GCRYPT_INCLUDE_DIR NAMES gcrypt.h REQUIRED)
find_library(GCRYPT_LIBRARY NAMES gcrypt REQUIRED)
add_library(Gcrypt::Gcrypt UNKNOWN IMPORTED)
set_target_properties(Gcrypt::Gcrypt PROPERTIES
    IMPORTED_LOCATION "${GCRYPT_LIBRARY}"
    INTERFACE_INCLUDE_DIRECTORIES "${GCRYPT_INCLUDE_DIR}")
add_library(dc24h_text src/text/public_text.cpp)
target_compile_features(dc24h_text PUBLIC cxx_std_20)
set_target_properties(dc24h_text PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_text PUBLIC include)
target_link_libraries(dc24h_text PRIVATE UTF8Proc::UTF8Proc)

# Detached persistent account metadata; deliberately independent of ADC/SQL.
add_library(dc24h_accounts src/accounts/account.cpp)
target_compile_features(dc24h_accounts PUBLIC cxx_std_20)
set_target_properties(dc24h_accounts PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_accounts PUBLIC include)
target_link_libraries(dc24h_accounts PRIVATE dc24h_text UTF8Proc::UTF8Proc)
target_compile_options(dc24h_accounts PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)

add_library(dc24h_roles src/security/roles.cpp src/security/moderation.cpp)
target_compile_features(dc24h_roles PUBLIC cxx_std_20)
set_target_properties(dc24h_roles PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_roles PUBLIC include)
target_link_libraries(dc24h_roles PUBLIC dc24h_accounts)
target_compile_options(dc24h_roles PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)

add_library(dc24h_users src/users/session.cpp src/users/session_manager.cpp src/users/auth_sessions.cpp src/users/user.cpp src/users/connectivity.cpp
    src/users/nick_manager.cpp src/users/user_registry.cpp src/users/limits.cpp)
target_compile_features(dc24h_users PUBLIC cxx_std_20)
set_target_properties(dc24h_users PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_users PUBLIC include)
target_link_libraries(dc24h_users PUBLIC dc24h_roles PRIVATE dc24h_text)

add_library(dc24h_chat src/chat/core.cpp src/chat/anti_flood.cpp src/chat/settings.cpp)
target_compile_features(dc24h_chat PUBLIC cxx_std_20)
set_target_properties(dc24h_chat PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_chat PUBLIC include)
target_link_libraries(dc24h_chat PUBLIC dc24h_users PRIVATE dc24h_text)

add_library(dc24h_search src/search/query.cpp src/search/security.cpp src/search/connectivity.cpp src/search/core.cpp src/search/features.cpp src/search/filters.cpp src/search/tokens.cpp)
target_compile_features(dc24h_search PUBLIC cxx_std_20)
set_target_properties(dc24h_search PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_search PUBLIC include)
target_link_libraries(dc24h_search PUBLIC dc24h_users PRIVATE dc24h_text UTF8Proc::UTF8Proc)

add_library(dc24h_transfers src/transfers/protocol_policy.cpp src/transfers/limits.cpp src/transfers/security.cpp src/transfers/token.cpp src/transfers/capabilities.cpp src/transfers/protocol.cpp src/transfers/request.cpp src/transfers/core.cpp)
target_compile_features(dc24h_transfers PUBLIC cxx_std_20)
set_target_properties(dc24h_transfers PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_transfers PUBLIC include)
target_link_libraries(dc24h_transfers PUBLIC dc24h_users PRIVATE dc24h_text)

add_library(dc24h_identity src/adc/identity_hash.cpp src/adc/tiger_identity.cpp)
target_compile_features(dc24h_identity PUBLIC cxx_std_20)
set_target_properties(dc24h_identity PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_identity PUBLIC include)
target_link_libraries(dc24h_identity PRIVATE Gcrypt::Gcrypt OpenSSL::Crypto)
add_library(dc24h_ban_model src/bans/bans.cpp)
target_compile_features(dc24h_ban_model PUBLIC cxx_std_20)
set_target_properties(dc24h_ban_model PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_ban_model PUBLIC include)
target_link_libraries(dc24h_ban_model PUBLIC dc24h_accounts dc24h_security PRIVATE dc24h_identity dc24h_text)
target_compile_options(dc24h_ban_model PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
add_library(dc24h_moderation src/admin/kick.cpp src/admin/mute.cpp)
target_compile_features(dc24h_moderation PUBLIC cxx_std_20)
set_target_properties(dc24h_moderation PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_moderation PUBLIC include)
target_link_libraries(dc24h_moderation PUBLIC dc24h_users dc24h_roles)
target_compile_options(dc24h_moderation PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
add_library(dc24h_adc src/adc/authentication.cpp src/adc/connection_errors.cpp src/adc/status_routing.cpp src/adc/parser.cpp src/adc/protocol_control.cpp src/adc/state.cpp src/adc/sup.cpp src/adc/sid.cpp src/adc/sid_session.cpp
    src/adc/inf.cpp src/adc/serializer.cpp src/adc/login.cpp src/adc/status.cpp src/adc/msg.cpp src/adc/sch.cpp src/adc/res.cpp src/adc/connection_routing.cpp src/adc/ctm.cpp src/adc/ctm_routing.cpp src/adc/rcm.cpp src/adc/rcm_routing.cpp src/adc/result_routing.cpp src/adc/search_routing.cpp src/adc/msg_flags.cpp src/adc/chat_validation.cpp src/adc/public_chat.cpp src/adc/private_chat.cpp src/adc/message_routing.cpp src/adc/hub_messages.cpp src/adc/user.cpp src/adc/user_login.cpp src/adc/user_list.cpp src/adc/inf_updates.cpp src/adc/user_disconnect.cpp src/adc/presence_flood.cpp)
target_compile_features(dc24h_adc PUBLIC cxx_std_20)
set_target_properties(dc24h_adc PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_adc PUBLIC include)
target_link_libraries(dc24h_adc PUBLIC dc24h_identity dc24h_ban_model dc24h_moderation dc24h_users dc24h_chat dc24h_search dc24h_transfers dc24h_security PRIVATE dc24h_text UTF8Proc::UTF8Proc Gcrypt::Gcrypt OpenSSL::Crypto)
set_source_files_properties(src/adc/protocol_control.cpp src/adc/presence_flood.cpp PROPERTIES
    COMPILE_OPTIONS "-Wall;-Wextra;-Wpedantic;-Wconversion;-Wshadow")

add_library(dc24h_adcs src/adcs/tls.cpp)
target_compile_features(dc24h_adcs PUBLIC cxx_std_20)
set_target_properties(dc24h_adcs PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_adcs PUBLIC include)
target_link_libraries(dc24h_adcs PUBLIC OpenSSL::SSL OpenSSL::Crypto)
set_source_files_properties(src/adcs/tls.cpp PROPERTIES
    COMPILE_OPTIONS "-Wall;-Wextra;-Wpedantic;-Wconversion;-Wshadow")

add_library(dc24h_security src/security/authentication_limits.cpp src/security/limits.cpp src/security/secret_file.cpp)
target_compile_features(dc24h_security PUBLIC cxx_std_20)
set_target_properties(dc24h_security PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_security PUBLIC include)
target_link_libraries(dc24h_security PRIVATE OpenSSL::Crypto)

add_library(dc24h_network src/network/tcp_server.cpp)
target_compile_features(dc24h_network PUBLIC cxx_std_20)
set_target_properties(dc24h_network PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_network PUBLIC include)
target_link_libraries(dc24h_network PUBLIC dc24h_logging dc24h_adc dc24h_adcs dc24h_security)

find_path(MARIADB_INCLUDE_DIR NAMES mysql.h PATH_SUFFIXES mariadb REQUIRED)
find_library(MARIADB_LIBRARY NAMES mariadb REQUIRED)
add_library(MariaDB::ConnectorC UNKNOWN IMPORTED)
set_target_properties(MariaDB::ConnectorC PROPERTIES
    IMPORTED_LOCATION "${MARIADB_LIBRARY}"
    INTERFACE_INCLUDE_DIRECTORIES "${MARIADB_INCLUDE_DIR}")
include(cmake/Migrations.cmake)
dc24h_generate_migrations("${CMAKE_CURRENT_SOURCE_DIR}/database/migrations"
    "${CMAKE_CURRENT_BINARY_DIR}/generated/dc24h/database/migrations.hpp")
add_library(dc24h_database src/database/database.cpp src/database/connection.cpp src/database/migrations.cpp src/database/backup.cpp)
target_compile_features(dc24h_database PUBLIC cxx_std_20)
set_target_properties(dc24h_database PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_database PUBLIC include PRIVATE src/database "${CMAKE_CURRENT_BINARY_DIR}/generated")
target_link_libraries(dc24h_database PRIVATE MariaDB::ConnectorC OpenSSL::Crypto dc24h_security Threads::Threads)

add_library(dc24h_audit src/audit/repository.cpp)
target_compile_features(dc24h_audit PUBLIC cxx_std_20)
set_target_properties(dc24h_audit PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_audit PUBLIC include)
target_link_libraries(dc24h_audit PUBLIC dc24h_database)
target_compile_options(dc24h_audit PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)

add_library(dc24h_account_repository src/accounts/repository.cpp)
target_compile_features(dc24h_account_repository PUBLIC cxx_std_20)
set_target_properties(dc24h_account_repository PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_account_repository PUBLIC include)
target_link_libraries(dc24h_account_repository PUBLIC dc24h_accounts dc24h_database)
target_compile_options(dc24h_account_repository PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)

add_library(dc24h_registration src/accounts/registration.cpp src/accounts/registration_password.cpp)
target_compile_features(dc24h_registration PUBLIC cxx_std_20)
set_target_properties(dc24h_registration PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_registration PUBLIC include PRIVATE src/accounts)
target_link_libraries(dc24h_registration PUBLIC dc24h_account_repository PRIVATE OpenSSL::Crypto UTF8Proc::UTF8Proc)
target_compile_options(dc24h_registration PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)

add_library(dc24h_password_security src/accounts/password_security.cpp src/accounts/password_verification.cpp)
target_compile_features(dc24h_password_security PUBLIC cxx_std_20)
set_target_properties(dc24h_password_security PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_password_security PUBLIC include PRIVATE src/accounts)
target_link_libraries(dc24h_password_security PUBLIC dc24h_registration PRIVATE OpenSSL::Crypto)
target_compile_options(dc24h_password_security PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)

add_library(dc24h_identity_mapping src/accounts/identity_mapping.cpp)
target_compile_features(dc24h_identity_mapping PUBLIC cxx_std_20)
set_target_properties(dc24h_identity_mapping PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_identity_mapping PUBLIC include)
target_link_libraries(dc24h_identity_mapping PUBLIC dc24h_account_repository dc24h_adc PRIVATE dc24h_text)
target_compile_options(dc24h_identity_mapping PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)

add_library(dc24h_account_authentication src/accounts/adc_authentication.cpp)
target_compile_features(dc24h_account_authentication PUBLIC cxx_std_20)
set_target_properties(dc24h_account_authentication PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_account_authentication PUBLIC include PRIVATE src/accounts)
target_link_libraries(dc24h_account_authentication PUBLIC dc24h_identity_mapping dc24h_password_security PRIVATE OpenSSL::Crypto dc24h_security)
target_compile_options(dc24h_account_authentication PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)

add_library(dc24h_account_management src/accounts/management.cpp)
target_compile_features(dc24h_account_management PUBLIC cxx_std_20)
set_target_properties(dc24h_account_management PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_account_management PUBLIC include PRIVATE src/accounts)
target_link_libraries(dc24h_account_management PUBLIC dc24h_account_authentication dc24h_roles PRIVATE OpenSSL::Crypto dc24h_audit)
target_compile_options(dc24h_account_management PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)

add_library(dc24h_benchmark src/benchmark/workload.cpp)
target_compile_features(dc24h_benchmark PUBLIC cxx_std_20)
set_target_properties(dc24h_benchmark PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_benchmark PUBLIC include)
target_link_libraries(dc24h_benchmark PUBLIC dc24h_roles)

add_library(dc24h_profile src/profile/bottleneck.cpp)
target_compile_features(dc24h_profile PUBLIC cxx_std_20)
set_target_properties(dc24h_profile PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_profile PUBLIC include)
target_link_libraries(dc24h_profile PUBLIC dc24h_roles)

add_library(dc24h_stress src/stress/soak.cpp)
target_compile_features(dc24h_stress PUBLIC cxx_std_20)
set_target_properties(dc24h_stress PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_stress PUBLIC include)
target_link_libraries(dc24h_stress PUBLIC dc24h_security dc24h_chat)

add_library(dc24h_monitoring src/monitoring/process.cpp)
target_compile_features(dc24h_monitoring PUBLIC cxx_std_20)
set_target_properties(dc24h_monitoring PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_monitoring PUBLIC include)

add_library(dc24h_api src/api/http.cpp src/api/server.cpp src/api/configuration.cpp)
target_compile_features(dc24h_api PUBLIC cxx_std_20)
set_target_properties(dc24h_api PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_api PUBLIC include PRIVATE "${CMAKE_CURRENT_BINARY_DIR}/generated")
target_link_libraries(dc24h_api PUBLIC dc24h_logging dc24h_roles PRIVATE Threads::Threads OpenSSL::Crypto dc24h_security)

add_library(dc24h_configuration src/configuration/configuration.cpp)
target_compile_features(dc24h_configuration PUBLIC cxx_std_20)
set_target_properties(dc24h_configuration PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_configuration PUBLIC include)
target_link_libraries(dc24h_configuration PUBLIC dc24h_network dc24h_logging dc24h_database dc24h_api PRIVATE UTF8Proc::UTF8Proc OpenSSL::Crypto)

add_library(dc24h_core
    src/core/server.cpp
    src/core/termination_signals.cpp
)
target_compile_features(dc24h_core PUBLIC cxx_std_20)
set_target_properties(dc24h_core PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_core PUBLIC include "${CMAKE_CURRENT_BINARY_DIR}/generated")
target_link_libraries(dc24h_core PUBLIC Threads::Threads dc24h_network dc24h_logging dc24h_transfers)
target_compile_definitions(dc24h_core PRIVATE _POSIX_C_SOURCE=200809L)

add_executable(dc24h src/main.cpp)
add_library(dc24h_bans src/bans/repository.cpp)
target_compile_features(dc24h_bans PUBLIC cxx_std_20)
set_target_properties(dc24h_bans PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_bans PUBLIC include PRIVATE src/accounts)
target_link_libraries(dc24h_bans PUBLIC dc24h_ban_model dc24h_account_management PRIVATE OpenSSL::Crypto dc24h_audit)
target_compile_options(dc24h_bans PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
add_library(dc24h_admin src/admin/core.cpp src/admin/access.cpp)
target_compile_features(dc24h_admin PUBLIC cxx_std_20)
set_target_properties(dc24h_admin PROPERTIES CXX_EXTENSIONS OFF)
target_include_directories(dc24h_admin PUBLIC include)
target_link_libraries(dc24h_admin PUBLIC dc24h_bans dc24h_audit PRIVATE OpenSSL::Crypto)
target_compile_options(dc24h_admin PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
add_library(dc24h_account_api src/api/accounts.cpp)
target_compile_features(dc24h_account_api PUBLIC cxx_std_20)
target_include_directories(dc24h_account_api PUBLIC include)
target_link_libraries(dc24h_account_api PUBLIC dc24h_api dc24h_admin dc24h_configuration)
target_compile_options(dc24h_account_api PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
add_executable(dc24h-owner src/owner_admin.cpp)
target_include_directories(dc24h-owner PRIVATE "${CMAKE_CURRENT_BINARY_DIR}/generated")
target_link_libraries(dc24h-owner PRIVATE dc24h_admin dc24h_configuration dc24h_security)
target_compile_options(dc24h-owner PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
add_executable(dc24h-account-admin src/account_admin.cpp)
target_include_directories(dc24h-account-admin PRIVATE "${CMAKE_CURRENT_BINARY_DIR}/generated")
target_link_libraries(dc24h-account-admin PRIVATE dc24h_account_api dc24h_configuration dc24h_core)
target_compile_options(dc24h-account-admin PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
set_target_properties(dc24h_account_api dc24h-account-admin PROPERTIES CXX_EXTENSIONS OFF)
add_executable(dc24h-service-controller src/service_control/controller.cpp)
target_include_directories(dc24h-service-controller PRIVATE "${CMAKE_CURRENT_BINARY_DIR}/generated")
target_compile_features(dc24h-service-controller PRIVATE cxx_std_20)
set_target_properties(dc24h-service-controller PROPERTIES CXX_EXTENSIONS OFF)
target_compile_options(dc24h-service-controller PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
target_link_libraries(dc24h PRIVATE dc24h_bans dc24h_core dc24h_configuration dc24h_account_authentication dc24h_monitoring)
set_target_properties(dc24h PROPERTIES CXX_EXTENSIONS OFF)

foreach(target dc24h_transfers dc24h_text dc24h_search dc24h_chat dc24h_users dc24h_i18n dc24h_core dc24h_network dc24h_logging dc24h_adc dc24h_adcs dc24h_security dc24h_configuration dc24h_database dc24h_api dc24h_monitoring dc24h_benchmark dc24h_profile dc24h_stress dc24h)
    target_compile_options(${target} PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
endforeach()

include(GNUInstallDirs)
install(TARGETS dc24h dc24h-account-admin dc24h-owner dc24h-service-controller RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
install(FILES config/dc24h.ini.example config/adc-accounts.ini.example config/apache2-webadmin-https.conf.example config/apache2-webadmin-https-proxy.conf.example config/apache2-webadmin-remote.conf.example config/dc24h-remote-gateway.service.example config/dc24h.service.example config/dc24h.sysusers.example config/dc24h-control.service.example config/dc24h-control.sysusers.example config/49-dc24h-control.rules.example DESTINATION ${CMAKE_INSTALL_SYSCONFDIR}/dc24h)

install(FILES ${DC24H_MIGRATION_FILES} DESTINATION ${CMAKE_INSTALL_DATADIR}/dc24h/migrations)

option(DC24H_INSTALL_WEBADMIN "Install prebuilt WebAdmin assets (run npm ci and npm run build first)" OFF)
if(DC24H_INSTALL_WEBADMIN)
    if(NOT EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/webadmin/dist/index.html")
        message(FATAL_ERROR "Build webadmin/dist with npm run build before enabling DC24H_INSTALL_WEBADMIN")
    endif()
    install(DIRECTORY webadmin/dist/ DESTINATION ${CMAKE_INSTALL_DATADIR}/dc24h/webadmin)
    install(FILES config/apache2-webadmin.conf.example DESTINATION ${CMAKE_INSTALL_SYSCONFDIR}/dc24h)
endif()

include(CTest)
option(DC24H_REQUIRE_INTEGRATION_TESTS "Fail configuration if integration-test tools are unavailable" OFF)
if(DC24H_REQUIRE_INTEGRATION_TESTS AND NOT BUILD_TESTING)
    message(FATAL_ERROR "DC24H_REQUIRE_INTEGRATION_TESTS requires BUILD_TESTING=ON")
endif()
if(BUILD_TESTING)
    find_package(Python3 3.8 REQUIRED COMPONENTS Interpreter)
    add_test(NAME integration.ncdc_ports COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_ports_tests.py")
    set_tests_properties(integration.ncdc_ports PROPERTIES TIMEOUT 15)
    add_test(NAME project.metadata COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/project_checks.py")
    set_tests_properties(project.metadata PROPERTIES TIMEOUT 15)
    add_test(NAME dependencies.audit COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/dependency_audit_tests.py"
        "${CMAKE_BINARY_DIR}"
        "$<TARGET_FILE:dc24h>"
        "$<TARGET_FILE:dc24h-owner>"
        "$<TARGET_FILE:dc24h-account-admin>")
    set_tests_properties(dependencies.audit PROPERTIES TIMEOUT 30)
    add_test(NAME security.threat_model COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/threat_model_tests.py")
    set_tests_properties(security.threat_model PROPERTIES TIMEOUT 15)
    add_test(NAME beta.baseline COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/beta_baseline_tests.py")
    add_test(NAME remote.gateway.config COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/remote_gateway_config_tests.py")
    add_test(NAME remote.pilot.preflight COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/remote_pilot_tests.py")
    set_tests_properties(remote.pilot.preflight PROPERTIES TIMEOUT 15)
    add_test(NAME beta.release.gate COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/beta_release_gate_tests.py")
    add_test(NAME beta.04.stage1 COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/beta_04_stage1_tests.py")
    set_tests_properties(beta.04.stage1 PROPERTIES TIMEOUT 15)
    set_tests_properties(beta.release.gate PROPERTIES TIMEOUT 15)
    set_tests_properties(beta.baseline PROPERTIES TIMEOUT 15)
    add_test(NAME service.controller.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/service_controller_process_tests.py"
        "$<TARGET_FILE:dc24h-service-controller>")
    set_tests_properties(service.controller.process PROPERTIES TIMEOUT 25)
    add_test(NAME configuration.policy.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/configuration_policy_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(configuration.policy.process PROPERTIES TIMEOUT 30)
    add_test(NAME database.catalog COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/migration_catalog_tests.py")
    set_tests_properties(database.catalog PROPERTIES TIMEOUT 30)
    find_program(OPENSSL_EXECUTABLE openssl)
    if(DC24H_REQUIRE_INTEGRATION_TESTS AND NOT OPENSSL_EXECUTABLE)
        message(FATAL_ERROR "Required integration-test tool missing: openssl")
    endif()
    add_executable(core_tests tests/core_tests.cpp)
    target_link_libraries(core_tests PRIVATE dc24h_core)
    set_target_properties(core_tests PROPERTIES CXX_EXTENSIONS OFF)
    target_compile_options(core_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    add_test(NAME core.lifecycle COMMAND core_tests)
    add_test(NAME core.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/process_tests.py" "$<TARGET_FILE:dc24h>")
    add_executable(network_tests tests/network_tests.cpp)
    target_link_libraries(network_tests PRIVATE dc24h_core)
    set_target_properties(network_tests PROPERTIES CXX_EXTENSIONS OFF)
    target_compile_options(network_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    add_test(NAME network.unit COMMAND network_tests)
    add_test(NAME network.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/network_process_tests.py" "$<TARGET_FILE:dc24h>")
    add_executable(adc_tests tests/adc_tests.cpp)
    target_link_libraries(adc_tests PRIVATE dc24h_adc)
    set_target_properties(adc_tests PROPERTIES CXX_EXTENSIONS OFF)
    target_compile_options(adc_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    add_test(NAME adc.parser COMMAND adc_tests)
    add_executable(adc_security_tests tests/adc_security_tests.cpp)
    target_link_libraries(adc_security_tests PRIVATE dc24h_adc)
    set_target_properties(adc_security_tests PROPERTIES CXX_EXTENSIONS OFF)
    target_compile_options(adc_security_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    add_test(NAME adc.security COMMAND adc_security_tests)
    add_executable(adc_sch_tests tests/adc_sch_tests.cpp)
    target_link_libraries(adc_sch_tests PRIVATE dc24h_adc)
    target_compile_options(adc_sch_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(adc_sch_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME adc.sch COMMAND adc_sch_tests)
    add_test(NAME adc.sch.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/adc_sch_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(adc.sch adc.sch.process PROPERTIES TIMEOUT 45)
    add_executable(adc_res_tests tests/adc_res_tests.cpp)
    target_link_libraries(adc_res_tests PRIVATE dc24h_adc)
    target_compile_options(adc_res_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(adc_res_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME adc.res COMMAND adc_res_tests)
    add_test(NAME adc.res.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/adc_res_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(adc.res adc.res.process PROPERTIES TIMEOUT 45)
    add_executable(result_routing_tests tests/result_routing_tests.cpp)
    target_link_libraries(result_routing_tests PRIVATE dc24h_adc)
    target_compile_options(result_routing_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(result_routing_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME search.results COMMAND result_routing_tests)
    add_test(NAME search.results.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/result_routing_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(search.results search.results.process PROPERTIES TIMEOUT 45)
    add_executable(search_connectivity_tests tests/search_connectivity_tests.cpp)
    target_link_libraries(search_connectivity_tests PRIVATE dc24h_adc)
    target_compile_options(search_connectivity_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(search_connectivity_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME search.connectivity COMMAND search_connectivity_tests)
    add_test(NAME search.connectivity.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/search_connectivity_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(search.connectivity search.connectivity.process PROPERTIES TIMEOUT 45)
    add_executable(search_security_tests tests/search_security_tests.cpp)
    target_link_libraries(search_security_tests PRIVATE dc24h_adc)
    target_compile_options(search_security_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(search_security_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME search.security COMMAND search_security_tests)
    add_test(NAME search.security.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/search_security_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(search.security search.security.process PROPERTIES TIMEOUT 60)
    add_executable(connection_routing_tests tests/connection_routing_tests.cpp)
    target_link_libraries(connection_routing_tests PRIVATE dc24h_adc)
    target_compile_options(connection_routing_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(connection_routing_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME transfers.routing COMMAND connection_routing_tests)
    add_test(NAME transfers.routing.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/connection_routing_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(transfers.routing transfers.routing.process PROPERTIES TIMEOUT 45)
    add_executable(transfer_configuration_tests tests/transfer_configuration_tests.cpp)
    target_link_libraries(transfer_configuration_tests PRIVATE dc24h_adc dc24h_configuration)
    target_compile_options(transfer_configuration_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(transfer_configuration_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME transfers.configuration COMMAND transfer_configuration_tests)
    add_test(NAME transfers.configuration.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/transfer_configuration_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(transfers.configuration transfers.configuration.process PROPERTIES TIMEOUT 90)
    add_executable(transfer_statistics_tests tests/transfer_statistics_tests.cpp)
    target_link_libraries(transfer_statistics_tests PRIVATE dc24h_adc)
    target_compile_options(transfer_statistics_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(transfer_statistics_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME transfers.statistics COMMAND transfer_statistics_tests)
    add_test(NAME transfers.statistics.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/transfer_statistics_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(transfers.statistics transfers.statistics.process PROPERTIES TIMEOUT 60)
    add_executable(transfer_limits_tests tests/transfer_limits_tests.cpp)
    target_link_libraries(transfer_limits_tests PRIVATE dc24h_adc)
    target_compile_options(transfer_limits_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(transfer_limits_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME transfers.limits COMMAND transfer_limits_tests)
    add_test(NAME transfers.limits.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/transfer_limits_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(transfers.limits transfers.limits.process PROPERTIES TIMEOUT 60)
    add_executable(transfer_errors_tests tests/transfer_errors_tests.cpp)
    target_link_libraries(transfer_errors_tests PRIVATE dc24h_adc)
    target_compile_options(transfer_errors_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(transfer_errors_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME transfers.errors COMMAND transfer_errors_tests)
    add_test(NAME transfers.errors.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/transfer_errors_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(transfers.errors transfers.errors.process PROPERTIES TIMEOUT 60)
    add_executable(connection_security_tests tests/connection_security_tests.cpp)
    target_link_libraries(connection_security_tests PRIVATE dc24h_adc)
    target_compile_options(connection_security_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(connection_security_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME transfers.security COMMAND connection_security_tests)
    add_test(NAME transfers.security.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/connection_security_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(transfers.security transfers.security.process PROPERTIES TIMEOUT 60)
    add_executable(protocol_negotiation_tests tests/protocol_negotiation_tests.cpp)
    add_executable(transfer_token_tests tests/transfer_token_tests.cpp)
    target_link_libraries(transfer_token_tests PRIVATE dc24h_adc)
    target_compile_options(transfer_token_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(transfer_token_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME transfers.tokens COMMAND transfer_token_tests)
    add_test(NAME transfers.tokens.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/transfer_tokens_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(transfers.tokens transfers.tokens.process PROPERTIES TIMEOUT 45)
    add_executable(client_capabilities_tests tests/client_capabilities_tests.cpp)
    target_link_libraries(client_capabilities_tests PRIVATE dc24h_adc)
    target_compile_options(client_capabilities_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(client_capabilities_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME transfers.capabilities COMMAND client_capabilities_tests)
    add_test(NAME transfers.capabilities.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/client_capabilities_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(transfers.capabilities transfers.capabilities.process PROPERTIES TIMEOUT 45)
    target_link_libraries(protocol_negotiation_tests PRIVATE dc24h_adc)
    target_compile_options(protocol_negotiation_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(protocol_negotiation_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME transfers.protocol COMMAND protocol_negotiation_tests)
    add_test(NAME transfers.protocol.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/protocol_negotiation_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(transfers.protocol transfers.protocol.process PROPERTIES TIMEOUT 45)
    add_executable(adc_rcm_tests tests/adc_rcm_tests.cpp)
    target_link_libraries(adc_rcm_tests PRIVATE dc24h_adc)
    target_compile_options(adc_rcm_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(adc_rcm_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME adc.rcm COMMAND adc_rcm_tests)
    add_test(NAME adc.rcm.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/adc_rcm_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(adc.rcm adc.rcm.process PROPERTIES TIMEOUT 45)
    add_executable(adc_ctm_tests tests/adc_ctm_tests.cpp)
    target_link_libraries(adc_ctm_tests PRIVATE dc24h_adc)
    target_compile_options(adc_ctm_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(adc_ctm_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME adc.ctm COMMAND adc_ctm_tests)
    add_test(NAME adc.ctm.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/adc_ctm_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(adc.ctm adc.ctm.process PROPERTIES TIMEOUT 45)
    add_executable(transfer_core_tests tests/transfer_core_tests.cpp)
    target_link_libraries(transfer_core_tests PRIVATE dc24h_transfers dc24h_search)
    target_compile_options(transfer_core_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(transfer_core_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME transfers.core COMMAND transfer_core_tests)
    add_test(NAME transfers.core.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/transfer_core_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(transfers.core transfers.core.process PROPERTIES TIMEOUT 45)
    add_executable(search_statistics_tests tests/search_statistics_tests.cpp)
    target_link_libraries(search_statistics_tests PRIVATE dc24h_adc)
    target_compile_options(search_statistics_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(search_statistics_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME search.statistics COMMAND search_statistics_tests)
    add_test(NAME search.statistics.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/search_statistics_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(search.statistics search.statistics.process PROPERTIES TIMEOUT 45)
    add_executable(search_core_tests tests/search_core_tests.cpp)
    target_link_libraries(search_core_tests PRIVATE dc24h_search)
    target_compile_options(search_core_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(search_core_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME search.core COMMAND search_core_tests)
    add_test(NAME search.core.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/search_core_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(search.core search.core.process PROPERTIES TIMEOUT 30)
    add_executable(search_filters_tests tests/search_filters_tests.cpp)
    target_link_libraries(search_filters_tests PRIVATE dc24h_adc)
    target_compile_options(search_filters_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(search_filters_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME search.filters COMMAND search_filters_tests)
    set_tests_properties(search.filters PROPERTIES TIMEOUT 30)
    add_executable(search_tth_tests tests/search_tth_tests.cpp)
    target_link_libraries(search_tth_tests PRIVATE dc24h_adc)
    target_compile_options(search_tth_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(search_tth_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME search.tth COMMAND search_tth_tests)
    set_tests_properties(search.tth PROPERTIES TIMEOUT 30)
    add_executable(search_tokens_tests tests/search_tokens_tests.cpp)
    target_link_libraries(search_tokens_tests PRIVATE dc24h_adc)
    target_compile_options(search_tokens_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(search_tokens_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME search.tokens COMMAND search_tokens_tests)
    add_test(NAME search.tokens.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/search_tokens_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(search.tokens search.tokens.process PROPERTIES TIMEOUT 30)
    add_executable(search_features_tests tests/search_features_tests.cpp)
    target_link_libraries(search_features_tests PRIVATE dc24h_adc)
    target_compile_options(search_features_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(search_features_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME search.features COMMAND search_features_tests)
    add_test(NAME search.features.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/search_features_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(search.features search.features.process PROPERTIES TIMEOUT 45)
    add_executable(search_routing_tests tests/search_routing_tests.cpp)
    target_link_libraries(search_routing_tests PRIVATE dc24h_adc)
    target_compile_options(search_routing_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(search_routing_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME search.routing COMMAND search_routing_tests)
    add_test(NAME search.routing.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/search_routing_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(search.routing search.routing.process PROPERTIES TIMEOUT 45)
    add_executable(chat_logging_tests tests/chat_logging_tests.cpp)
    target_link_libraries(chat_logging_tests PRIVATE dc24h_adc)
    target_compile_options(chat_logging_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(chat_logging_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME chat.logging COMMAND chat_logging_tests)
    add_test(NAME chat.logging.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/chat_logging_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(chat.logging chat.logging.process PROPERTIES TIMEOUT 45)
    add_executable(chat_configuration_tests tests/chat_configuration_tests.cpp)
    target_link_libraries(chat_configuration_tests PRIVATE dc24h_adc)
    target_compile_options(chat_configuration_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(chat_configuration_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME chat.configuration COMMAND chat_configuration_tests)
    add_test(NAME chat.configuration.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/chat_configuration_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(chat.configuration chat.configuration.process PROPERTIES TIMEOUT 30)
    add_executable(anti_flood_tests tests/anti_flood_tests.cpp)
    target_link_libraries(anti_flood_tests PRIVATE dc24h_adc)
    target_compile_options(anti_flood_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(anti_flood_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME chat.anti_flood COMMAND anti_flood_tests)
    add_test(NAME chat.anti_flood.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/anti_flood_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(chat.anti_flood chat.anti_flood.process PROPERTIES TIMEOUT 30)
    add_executable(presence_flood_tests tests/presence_flood_tests.cpp)
    target_link_libraries(presence_flood_tests PRIVATE dc24h_adc)
    target_compile_options(presence_flood_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(presence_flood_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME adc.presence COMMAND presence_flood_tests)
    add_test(NAME adc.presence.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/presence_flood_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(adc.presence adc.presence.process PROPERTIES TIMEOUT 30)
    add_executable(chat_validation_tests tests/chat_validation_tests.cpp)
    target_link_libraries(chat_validation_tests PRIVATE dc24h_adc)
    target_compile_options(chat_validation_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(chat_validation_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME chat.validation COMMAND chat_validation_tests)
    add_test(NAME chat.validation.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/chat_validation_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(chat.validation chat.validation.process PROPERTIES TIMEOUT 30)
    add_executable(hub_messages_tests tests/hub_messages_tests.cpp)
    target_link_libraries(hub_messages_tests PRIVATE dc24h_adc)
    target_compile_options(hub_messages_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(hub_messages_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME chat.hub COMMAND hub_messages_tests)
    add_test(NAME chat.hub.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/hub_messages_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(chat.hub chat.hub.process PROPERTIES TIMEOUT 30)
    add_executable(message_flags_tests tests/message_flags_tests.cpp)
    target_link_libraries(message_flags_tests PRIVATE dc24h_adc)
    target_compile_options(message_flags_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(message_flags_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME adc.msg.flags COMMAND message_flags_tests)
    add_test(NAME adc.msg.flags.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/message_flags_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(adc.msg.flags adc.msg.flags.process PROPERTIES TIMEOUT 30)
    add_executable(message_routing_tests tests/message_routing_tests.cpp)
    target_link_libraries(message_routing_tests PRIVATE dc24h_adc)
    target_compile_options(message_routing_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(message_routing_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME chat.routing COMMAND message_routing_tests)
    add_test(NAME chat.routing.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/message_routing_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(chat.routing chat.routing.process PROPERTIES TIMEOUT 30)
    add_executable(private_chat_tests tests/private_chat_tests.cpp)
    target_link_libraries(private_chat_tests PRIVATE dc24h_adc)
    target_compile_options(private_chat_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(private_chat_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME chat.private COMMAND private_chat_tests)
    add_test(NAME chat.private.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/private_chat_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(chat.private chat.private.process PROPERTIES TIMEOUT 30)
    add_executable(public_chat_tests tests/public_chat_tests.cpp)
    target_link_libraries(public_chat_tests PRIVATE dc24h_adc)
    target_compile_options(public_chat_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(public_chat_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME chat.public COMMAND public_chat_tests)
    add_test(NAME chat.public.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/public_chat_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(chat.public chat.public.process PROPERTIES TIMEOUT 30)
    add_executable(chat_adc_tests tests/chat_adc_tests.cpp)
    target_link_libraries(chat_adc_tests PRIVATE dc24h_adc)
    target_compile_options(chat_adc_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(chat_adc_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME chat.adc COMMAND chat_adc_tests)
    set_tests_properties(chat.adc PROPERTIES TIMEOUT 30)
    add_executable(chat_core_tests tests/chat_core_tests.cpp)
    target_link_libraries(chat_core_tests PRIVATE dc24h_chat)
    target_compile_options(chat_core_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(chat_core_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME chat.core COMMAND chat_core_tests)
    add_test(NAME chat.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/chat_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(chat.core chat.process PROPERTIES TIMEOUT 30)
    add_executable(adc_msg_tests tests/adc_msg_tests.cpp)
    target_link_libraries(adc_msg_tests PRIVATE dc24h_adc)
    target_compile_options(adc_msg_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(adc_msg_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME adc.msg COMMAND adc_msg_tests)
    add_test(NAME adc.msg.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/adc_msg_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(adc.msg adc.msg.process PROPERTIES TIMEOUT 30)
    add_executable(adc_syntax_tests tests/adc_syntax_tests.cpp)
    target_link_libraries(adc_syntax_tests PRIVATE dc24h_adc)
    target_compile_options(adc_syntax_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(adc_syntax_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME adc.syntax COMMAND adc_syntax_tests)
    add_executable(adc_state_tests tests/adc_state_tests.cpp)
    target_link_libraries(adc_state_tests PRIVATE dc24h_adc)
    target_compile_options(adc_state_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(adc_state_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME adc.state COMMAND adc_state_tests)
    set_tests_properties(adc.state PROPERTIES TIMEOUT 15)
    add_executable(adc_sup_tests tests/adc_sup_tests.cpp)
    target_link_libraries(adc_sup_tests PRIVATE dc24h_adc)
    target_compile_options(adc_sup_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(adc_sup_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME adc.sup COMMAND adc_sup_tests)
    set_tests_properties(adc.sup PROPERTIES TIMEOUT 15)
    add_executable(adc_sid_tests tests/adc_sid_tests.cpp)
    target_link_libraries(adc_sid_tests PRIVATE dc24h_adc)
    target_compile_options(adc_sid_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(adc_sid_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME adc.sid COMMAND adc_sid_tests)
    set_tests_properties(adc.sid PROPERTIES TIMEOUT 60)
    add_executable(adc_close_runner tests/adc_close_runner.cpp)
    target_link_libraries(adc_close_runner PRIVATE dc24h_core)
    target_link_options(adc_close_runner PRIVATE -Wl,--wrap=accept4 -Wl,--wrap=setsockopt)
    target_compile_options(adc_close_runner PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(adc_close_runner PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME adc.close.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/adc_close_process_tests.py" "$<TARGET_FILE:adc_close_runner>")
    set_tests_properties(adc.close.process PROPERTIES TIMEOUT 30)
    add_executable(adc_status_tests tests/adc_status_tests.cpp)
    target_link_libraries(adc_status_tests PRIVATE dc24h_adc)
    target_compile_options(adc_status_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(adc_status_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME adc.status COMMAND adc_status_tests)
    add_test(NAME adc.status.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/adc_status_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(adc.status adc.status.process PROPERTIES TIMEOUT 45)
    add_executable(user_disconnect_tests tests/user_disconnect_tests.cpp)
    target_link_libraries(user_disconnect_tests PRIVATE dc24h_adc)
    target_compile_options(user_disconnect_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(user_disconnect_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME users.disconnect COMMAND user_disconnect_tests)
    add_test(NAME users.disconnect.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/user_disconnect_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(users.disconnect users.disconnect.process PROPERTIES TIMEOUT 30)
    add_executable(statistics_tests tests/statistics_tests.cpp)
    target_link_libraries(statistics_tests PRIVATE dc24h_adc)
    target_compile_options(statistics_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(statistics_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME users.statistics COMMAND statistics_tests)
    add_test(NAME users.statistics.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/statistics_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(users.statistics users.statistics.process PROPERTIES TIMEOUT 30)
    add_executable(user_limits_tests tests/user_limits_tests.cpp)
    target_link_libraries(user_limits_tests PRIVATE dc24h_adc)
    target_compile_options(user_limits_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(user_limits_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME users.limits COMMAND user_limits_tests)
    add_test(NAME users.limits.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/user_limits_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(users.limits users.limits.process PROPERTIES TIMEOUT 30)
    add_executable(inf_updates_tests tests/inf_updates_tests.cpp)
    target_link_libraries(inf_updates_tests PRIVATE dc24h_adc)
    target_compile_options(inf_updates_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(inf_updates_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME users.inf_updates COMMAND inf_updates_tests)
    add_test(NAME users.inf_updates.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/inf_updates_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(users.inf_updates users.inf_updates.process PROPERTIES TIMEOUT 30)
    add_executable(user_list_tests tests/user_list_tests.cpp)
    target_link_libraries(user_list_tests PRIVATE dc24h_adc)
    target_compile_options(user_list_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(user_list_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME users.list COMMAND user_list_tests)
    add_test(NAME users.list.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/user_list_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(users.list users.list.process PROPERTIES TIMEOUT 30)
    add_executable(user_login_tests tests/user_login_tests.cpp)
    target_link_libraries(user_login_tests PRIVATE dc24h_adc)
    target_compile_options(user_login_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(user_login_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME users.login COMMAND user_login_tests)
    add_test(NAME users.login.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/user_login_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(users.login users.login.process PROPERTIES TIMEOUT 30)
    add_executable(user_registry_tests tests/user_registry_tests.cpp)
    target_link_libraries(user_registry_tests PRIVATE dc24h_users)
    target_compile_options(user_registry_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(user_registry_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME users.user_registry COMMAND user_registry_tests)
    add_test(NAME users.user_registry.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/user_registry_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(users.user_registry users.user_registry.process PROPERTIES TIMEOUT 30)
    add_executable(nick_manager_tests tests/nick_manager_tests.cpp)
    target_link_libraries(nick_manager_tests PRIVATE dc24h_users)
    target_compile_options(nick_manager_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(nick_manager_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME users.nicknames COMMAND nick_manager_tests)
    add_test(NAME users.nicknames.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/nick_manager_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(users.nicknames users.nicknames.process PROPERTIES TIMEOUT 30)
    add_executable(account_model_tests tests/account_model_tests.cpp)
    target_link_libraries(account_model_tests PRIVATE dc24h_accounts)
    target_compile_options(account_model_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(account_model_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME accounts.model COMMAND account_model_tests)
    set_tests_properties(accounts.model PROPERTIES TIMEOUT 15)

    add_executable(user_values_tests tests/user_values_tests.cpp)
    target_link_libraries(user_values_tests PRIVATE dc24h_adc dc24h_text)
    target_compile_options(user_values_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(user_values_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME users.values COMMAND user_values_tests)
    set_tests_properties(users.values PROPERTIES TIMEOUT 30)
    add_executable(session_registry_tests tests/session_registry_tests.cpp)
    target_link_libraries(session_registry_tests PRIVATE dc24h_users)
    target_compile_options(session_registry_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    add_test(NAME users.registry COMMAND session_registry_tests)
    set_tests_properties(users.registry PROPERTIES TIMEOUT 30)
    add_executable(authentication_limit_tests tests/authentication_limit_tests.cpp)
    target_link_libraries(authentication_limit_tests PRIVATE dc24h_adc)
    target_compile_options(authentication_limit_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    target_link_options(authentication_limit_tests PRIVATE -Wl,--wrap=RAND_bytes)
    add_test(NAME security.authentication_limits COMMAND authentication_limit_tests)
    set_tests_properties(security.authentication_limits PROPERTIES TIMEOUT 30)
    add_executable(bans_runtime_tests tests/bans_runtime_tests.cpp)
    target_link_libraries(bans_runtime_tests PRIVATE dc24h_adc)
    target_compile_options(bans_runtime_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    target_link_options(bans_runtime_tests PRIVATE -Wl,--wrap=RAND_bytes)
    add_test(NAME bans.admission COMMAND bans_runtime_tests)
    set_tests_properties(bans.admission PROPERTIES TIMEOUT 20)
    add_executable(bans_tests tests/bans_tests.cpp)
    target_link_libraries(bans_tests PRIVATE dc24h_bans dc24h_admin)
    target_compile_options(bans_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    target_link_options(bans_tests PRIVATE -Wl,--wrap=EVP_PBE_scrypt)
    add_test(NAME bans.model COMMAND bans_tests)
    set_tests_properties(bans.model PROPERTIES TIMEOUT 15)
    add_executable(mute_tests tests/mute_tests.cpp)
    target_link_libraries(mute_tests PRIVATE dc24h_adc)
    target_compile_options(mute_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    target_link_options(mute_tests PRIVATE -Wl,--wrap=RAND_bytes)
    add_test(NAME admin.mute COMMAND mute_tests)
    set_tests_properties(admin.mute PROPERTIES TIMEOUT 30)
    add_executable(kick_tests tests/kick_tests.cpp)
    target_link_libraries(kick_tests PRIVATE dc24h_adc)
    target_compile_options(kick_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    target_link_options(kick_tests PRIVATE -Wl,--wrap=RAND_bytes)
    add_test(NAME admin.kick COMMAND kick_tests)
    set_tests_properties(admin.kick PROPERTIES TIMEOUT 30)
    add_executable(moderation_tests tests/moderation_tests.cpp)
    target_link_libraries(moderation_tests PRIVATE dc24h_roles)
    target_compile_options(moderation_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(moderation_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME security.moderation COMMAND moderation_tests)
    set_tests_properties(security.moderation PROPERTIES TIMEOUT 15)
    add_executable(roles_tests tests/roles_tests.cpp)
    target_link_libraries(roles_tests PRIVATE dc24h_adc)
    target_compile_options(roles_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    target_link_options(roles_tests PRIVATE -Wl,--wrap=RAND_bytes)
    add_test(NAME security.roles COMMAND roles_tests)
    set_tests_properties(security.roles PROPERTIES TIMEOUT 30)
    add_executable(auth_session_tests tests/auth_session_tests.cpp)
    target_link_libraries(auth_session_tests PRIVATE dc24h_users)
    target_compile_options(auth_session_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    add_test(NAME users.auth_sessions COMMAND auth_session_tests)
    set_tests_properties(users.auth_sessions PROPERTIES TIMEOUT 30)
    add_executable(session_manager_tests tests/session_manager_tests.cpp)
    target_link_libraries(session_manager_tests PRIVATE dc24h_adc)
    target_compile_options(session_manager_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    add_test(NAME users.manager COMMAND session_manager_tests)
    set_tests_properties(users.manager PROPERTIES TIMEOUT 30)
    add_executable(user_core_tests tests/user_core_tests.cpp)
    target_link_libraries(user_core_tests PRIVATE dc24h_adc)
    target_compile_options(user_core_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    add_test(NAME users.core COMMAND user_core_tests)
    set_tests_properties(users.core PROPERTIES TIMEOUT 30)
    add_executable(user_session_tests tests/user_session_tests.cpp)
    target_link_libraries(user_session_tests PRIVATE dc24h_users)
    add_executable(user_session_adc_tests tests/user_session_adc_tests.cpp)
    target_link_libraries(user_session_adc_tests PRIVATE dc24h_adc)
    foreach(target user_session_tests user_session_adc_tests)
        target_compile_options(${target} PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
        set_target_properties(${target} PROPERTIES CXX_EXTENSIONS OFF)
    endforeach()
    add_test(NAME users.session COMMAND user_session_tests)
    add_test(NAME users.session.adc COMMAND user_session_adc_tests)
    add_test(NAME users.session.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/user_session_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(users.session users.session.adc users.session.process PROPERTIES TIMEOUT 30)
    add_executable(adc_login_tests tests/adc_login_tests.cpp)
    target_link_libraries(adc_login_tests PRIVATE dc24h_adc)
    target_compile_options(adc_login_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(adc_login_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME adc.login COMMAND adc_login_tests)
    set_tests_properties(adc.login PROPERTIES TIMEOUT 30)
    add_test(NAME adc.login.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/adc_login_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(adc.login.process PROPERTIES TIMEOUT 45)
    add_executable(adc_inf_tests tests/adc_inf_tests.cpp)
    target_link_libraries(adc_inf_tests PRIVATE dc24h_adc)
    target_compile_options(adc_inf_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(adc_inf_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME adc.inf COMMAND adc_inf_tests)
    set_tests_properties(adc.inf PROPERTIES TIMEOUT 30)
    add_executable(adc_identity_tests tests/adc_identity_tests.cpp)
    target_link_libraries(adc_identity_tests PRIVATE dc24h_adc)
    target_compile_options(adc_identity_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(adc_identity_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME adc.identity COMMAND adc_identity_tests)
    add_executable(adc_identity_failure_tests tests/adc_identity_failure_tests.cpp)
    target_link_libraries(adc_identity_failure_tests PRIVATE dc24h_adc Gcrypt::Gcrypt)
    target_compile_options(adc_identity_failure_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    target_link_options(adc_identity_failure_tests PRIVATE -Wl,--wrap=gcry_md_algo_info
        -Wl,--wrap=gcry_md_open -Wl,--wrap=gcry_md_read)
    set_target_properties(adc_identity_failure_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME adc.identity.failure COMMAND adc_identity_failure_tests)
    set_tests_properties(adc.identity adc.identity.failure PROPERTIES TIMEOUT 30)
    add_test(NAME adc.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/adc_process_tests.py" "$<TARGET_FILE:dc24h>")
    add_executable(adcs_unit_tests tests/adcs_unit_tests.cpp)
    target_link_libraries(adcs_unit_tests PRIVATE dc24h_adcs)
    set_target_properties(adcs_unit_tests PROPERTIES CXX_EXTENSIONS OFF)
    target_compile_options(adcs_unit_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    add_test(NAME adcs.crypto COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/adcs_unit_runner.py" "$<TARGET_FILE:adcs_unit_tests>")
    add_test(NAME adcs.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/adcs_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(adcs.crypto adcs.process PROPERTIES TIMEOUT 45)
    add_executable(tls_security_tests tests/tls_security_tests.cpp)
    target_link_libraries(tls_security_tests PRIVATE dc24h_adcs)
    target_compile_options(tls_security_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(tls_security_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME adcs.tls_security COMMAND tls_security_tests)
    add_test(NAME adcs.tls_security.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/tls_security_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(adcs.tls_security adcs.tls_security.process PROPERTIES TIMEOUT 30)
    add_executable(configuration_tests tests/configuration_tests.cpp)
    target_link_libraries(configuration_tests PRIVATE dc24h_configuration)
    set_target_properties(configuration_tests PROPERTIES CXX_EXTENSIONS OFF)
    target_compile_options(configuration_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    add_test(NAME configuration.unit COMMAND configuration_tests)
    add_executable(configuration_review_tests tests/configuration_review_tests.cpp)
    target_link_libraries(configuration_review_tests PRIVATE dc24h_configuration)
    set_target_properties(configuration_review_tests PROPERTIES CXX_EXTENSIONS OFF)
    target_compile_options(configuration_review_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    add_test(NAME configuration.review COMMAND configuration_review_tests)
    add_executable(configuration_write_tests tests/configuration_write_tests.cpp)
    target_link_libraries(configuration_write_tests PRIVATE dc24h_configuration)
    set_target_properties(configuration_write_tests PROPERTIES CXX_EXTENSIONS OFF)
    target_compile_options(configuration_write_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    add_test(NAME configuration.write COMMAND configuration_write_tests)
    add_test(NAME configuration.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/configuration_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(configuration.unit configuration.review configuration.write configuration.process PROPERTIES TIMEOUT 45)
    add_executable(logging_tests tests/logging_tests.cpp)
    target_link_libraries(logging_tests PRIVATE dc24h_logging UTF8Proc::UTF8Proc)
    target_link_options(logging_tests PRIVATE -Wl,--wrap=write)
    set_target_properties(logging_tests PROPERTIES CXX_EXTENSIONS OFF)
    target_compile_options(logging_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    add_executable(profile_tests tests/profile_tests.cpp)
    target_link_libraries(profile_tests PRIVATE dc24h_profile)
    target_compile_options(profile_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(profile_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME profile.unit COMMAND profile_tests)
    add_executable(stress_tests tests/stress_tests.cpp)
    target_link_libraries(stress_tests PRIVATE dc24h_stress)
    target_compile_options(stress_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(stress_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME stress.unit COMMAND stress_tests)
    add_executable(memory_safety_tests tests/memory_safety_tests.cpp)
    target_link_libraries(memory_safety_tests PRIVATE Threads::Threads)
    target_compile_options(memory_safety_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(memory_safety_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME memory.safety COMMAND memory_safety_tests)
    add_executable(benchmark_tests tests/benchmark_tests.cpp)
    target_link_libraries(benchmark_tests PRIVATE dc24h_benchmark)
    target_compile_options(benchmark_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(benchmark_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME benchmark.unit COMMAND benchmark_tests)
    add_executable(monitoring_tests tests/monitoring_tests.cpp)
    target_link_libraries(monitoring_tests PRIVATE dc24h_monitoring)
    target_compile_options(monitoring_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(monitoring_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME monitoring.unit COMMAND monitoring_tests)
    add_test(NAME logging.unit COMMAND logging_tests)
    add_test(NAME logging.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/logging_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(logging.unit logging.process PROPERTIES TIMEOUT 45)
    add_executable(negotiation_tests tests/negotiation_tests.cpp)
    target_link_libraries(negotiation_tests PRIVATE dc24h_security)
    target_compile_options(negotiation_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(negotiation_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME security.negotiation COMMAND negotiation_tests)
    add_test(NAME security.negotiation.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/negotiation_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(security.negotiation security.negotiation.process PROPERTIES TIMEOUT 45)
    add_executable(security_tests tests/security_tests.cpp)
    target_link_libraries(security_tests PRIVATE dc24h_security)
    set_target_properties(security_tests PROPERTIES CXX_EXTENSIONS OFF)
    target_compile_options(security_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    add_test(NAME security.unit COMMAND security_tests)
    add_test(NAME security.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/security_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(security.unit security.process PROPERTIES TIMEOUT 45)
    add_executable(account_webadmin_tests tests/account_webadmin_tests.cpp)
    set_target_properties(account_webadmin_tests PROPERTIES CXX_EXTENSIONS OFF)
    target_link_libraries(account_webadmin_tests PRIVATE dc24h_account_api)
    target_compile_options(account_webadmin_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    add_executable(database_tests tests/database_tests.cpp)
    target_link_libraries(database_tests PRIVATE dc24h_database)
    target_compile_options(database_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    add_test(NAME database.unit COMMAND database_tests)
    set_tests_properties(database.unit PROPERTIES TIMEOUT 15)
    add_executable(database_core_tests tests/database_core_tests.cpp)
    target_link_libraries(database_core_tests PRIVATE dc24h_database Threads::Threads)
    target_compile_options(database_core_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    add_test(NAME database.core COMMAND database_core_tests)
    set_tests_properties(database.core PROPERTIES TIMEOUT 15)
    add_executable(database_resilience_tests tests/database_resilience_tests.cpp)
    target_link_libraries(database_resilience_tests PRIVATE dc24h_database Threads::Threads)
    target_compile_features(database_resilience_tests PRIVATE cxx_std_20)
    set_target_properties(database_resilience_tests PROPERTIES CXX_EXTENSIONS OFF)
    target_compile_options(database_resilience_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    add_test(NAME database.resilience COMMAND database_resilience_tests)
    set_tests_properties(database.resilience PROPERTIES TIMEOUT 15)
    add_executable(database_migrations_tests tests/database_migrations_tests.cpp)
    target_link_libraries(database_migrations_tests PRIVATE dc24h_database OpenSSL::Crypto Threads::Threads)
    target_include_directories(database_migrations_tests PRIVATE src/database "${CMAKE_CURRENT_BINARY_DIR}/generated")
    target_compile_options(database_migrations_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    add_test(NAME database.migrations COMMAND database_migrations_tests)
    set_tests_properties(database.migrations PROPERTIES TIMEOUT 15)
    add_executable(account_repository_tests tests/account_repository_tests.cpp)
    target_link_libraries(account_repository_tests PRIVATE dc24h_account_repository Threads::Threads)
    target_compile_options(account_repository_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(account_repository_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_executable(registration_tests tests/registration_tests.cpp)
    target_link_libraries(registration_tests PRIVATE dc24h_registration OpenSSL::Crypto Threads::Threads)
    target_include_directories(registration_tests PRIVATE src/accounts)
    target_compile_options(registration_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(registration_tests PROPERTIES CXX_EXTENSIONS OFF)
    target_link_options(registration_tests PRIVATE -Wl,--wrap=RAND_bytes -Wl,--wrap=EVP_PBE_scrypt -Wl,--wrap=OPENSSL_cleanse)
    add_executable(admin_core_tests tests/admin_core_tests.cpp)
    target_link_libraries(admin_core_tests PRIVATE dc24h_admin)
    target_compile_options(admin_core_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    add_test(NAME admin.core COMMAND admin_core_tests)
    set_tests_properties(admin.core PROPERTIES TIMEOUT 15)
    add_executable(admin_access_tests tests/admin_access_tests.cpp)
    target_link_libraries(admin_access_tests PRIVATE dc24h_admin)
    target_compile_options(admin_access_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    add_test(NAME admin.access COMMAND admin_access_tests)
    set_tests_properties(admin.access PROPERTIES TIMEOUT 15)
    add_executable(account_management_tests tests/account_management_tests.cpp)
    target_link_libraries(account_management_tests PRIVATE dc24h_account_management OpenSSL::Crypto Threads::Threads)
    target_include_directories(account_management_tests PRIVATE src/accounts)
    target_compile_options(account_management_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    target_link_options(account_management_tests PRIVATE -Wl,--wrap=RAND_bytes -Wl,--wrap=EVP_PBE_scrypt -Wl,--wrap=OPENSSL_cleanse)
    add_executable(adc_credential_tests tests/adc_credential_tests.cpp)
    target_link_libraries(adc_credential_tests PRIVATE dc24h_account_authentication OpenSSL::Crypto)
    target_compile_options(adc_credential_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    target_link_options(adc_credential_tests PRIVATE -Wl,--wrap=RAND_bytes -Wl,--wrap=OPENSSL_cleanse)
    add_executable(adc_authentication_tests tests/adc_authentication_tests.cpp)
    target_link_libraries(adc_authentication_tests PRIVATE dc24h_adc Gcrypt::Gcrypt OpenSSL::Crypto)
    target_compile_options(adc_authentication_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    target_link_options(adc_authentication_tests PRIVATE -Wl,--wrap=RAND_bytes -Wl,--wrap=gcry_md_open -Wl,--wrap=CRYPTO_memcmp -Wl,--wrap=OPENSSL_cleanse)
    add_test(NAME adc.authentication COMMAND adc_authentication_tests)
    set_tests_properties(adc.authentication PROPERTIES TIMEOUT 20)
    add_executable(account_security_tests tests/account_security_tests.cpp)
    target_link_libraries(account_security_tests PRIVATE dc24h_adc)
    target_compile_options(account_security_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(account_security_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME accounts.account_security COMMAND account_security_tests)
    set_tests_properties(accounts.account_security PROPERTIES TIMEOUT 30)
    add_executable(password_security_tests tests/password_security_tests.cpp)
    target_link_libraries(password_security_tests PRIVATE dc24h_password_security OpenSSL::Crypto Threads::Threads)
    target_include_directories(password_security_tests PRIVATE src/accounts)
    target_compile_options(password_security_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(password_security_tests PROPERTIES CXX_EXTENSIONS OFF)
    target_link_options(password_security_tests PRIVATE -Wl,--wrap=EVP_PBE_scrypt -Wl,--wrap=CRYPTO_memcmp -Wl,--wrap=OPENSSL_cleanse)
    add_test(NAME accounts.password_security COMMAND password_security_tests)
    set_tests_properties(accounts.password_security PROPERTIES TIMEOUT 45)
    add_executable(identity_mapping_tests tests/identity_mapping_tests.cpp)
    target_link_libraries(identity_mapping_tests PRIVATE dc24h_identity_mapping Threads::Threads)
    target_compile_options(identity_mapping_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    set_target_properties(identity_mapping_tests PROPERTIES CXX_EXTENSIONS OFF)
    add_test(NAME accounts.identity_mapping COMMAND identity_mapping_tests)
    set_tests_properties(accounts.identity_mapping PROPERTIES TIMEOUT 15)
    add_test(NAME accounts.registration COMMAND registration_tests)
    set_tests_properties(accounts.registration PROPERTIES TIMEOUT 30)
    find_program(MARIADBD_EXECUTABLE mariadbd PATHS /usr/sbin)
    find_program(MARIADB_INSTALL_DB_EXECUTABLE mariadb-install-db)
    find_program(MARIADB_CLIENT_EXECUTABLE mariadb)
    find_program(MARIADB_ADMIN_EXECUTABLE mariadb-admin)
    if(MARIADBD_EXECUTABLE AND MARIADB_INSTALL_DB_EXECUTABLE AND MARIADB_CLIENT_EXECUTABLE AND MARIADB_ADMIN_EXECUTABLE)
        add_test(NAME bans.process COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/database_process_tests.py"
            "$<TARGET_FILE:dc24h>" "$<TARGET_FILE:database_tests>"
            --bans-test "$<TARGET_FILE:bans_tests>")
        set_tests_properties(bans.process PROPERTIES TIMEOUT 150
            ENVIRONMENT "PATH=/usr/sbin:/usr/bin:/sbin:/bin:$ENV{PATH}")
        add_test(NAME admin.core.process COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/database_process_tests.py"
            "$<TARGET_FILE:dc24h>" "$<TARGET_FILE:database_tests>"
            --admin-core-test "$<TARGET_FILE:admin_core_tests>")
        set_tests_properties(admin.core.process PROPERTIES TIMEOUT 120
            ENVIRONMENT "PATH=/usr/sbin:/usr/bin:/sbin:/bin:$ENV{PATH}")
        add_test(NAME accounts.owner_cli.process COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/database_process_tests.py"
            "$<TARGET_FILE:dc24h>" "$<TARGET_FILE:database_tests>"
            --owner-cli-test "$<TARGET_FILE:dc24h-owner>")
        set_tests_properties(accounts.owner_cli.process PROPERTIES TIMEOUT 120
            ENVIRONMENT "PATH=/usr/sbin:/usr/bin:/sbin:/bin:$ENV{PATH}")
        add_test(NAME accounts.management.process COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/database_process_tests.py"
            "$<TARGET_FILE:dc24h>" "$<TARGET_FILE:database_tests>"
            --management-test "$<TARGET_FILE:account_management_tests>")
        set_tests_properties(accounts.management.process PROPERTIES TIMEOUT 210
            ENVIRONMENT "PATH=/usr/sbin:/usr/bin:/sbin:/bin:$ENV{PATH}")
        add_test(NAME accounts.adc_authentication.process COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/database_process_tests.py"
            "$<TARGET_FILE:dc24h>" "$<TARGET_FILE:database_tests>"
            --adc-authentication-test "$<TARGET_FILE:adc_credential_tests>")
        set_tests_properties(accounts.adc_authentication.process PROPERTIES TIMEOUT 120
            ENVIRONMENT "PATH=/usr/sbin:/usr/bin:/sbin:/bin:$ENV{PATH}")
        add_test(NAME accounts.password_security.process COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/database_process_tests.py"
            "$<TARGET_FILE:dc24h>" "$<TARGET_FILE:database_tests>"
            --password-test "$<TARGET_FILE:password_security_tests>")
        set_tests_properties(accounts.password_security.process PROPERTIES TIMEOUT 120
            ENVIRONMENT "PATH=/usr/sbin:/usr/bin:/sbin:/bin:$ENV{PATH}")
        add_test(NAME accounts.identity_mapping.process COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/database_process_tests.py"
            "$<TARGET_FILE:dc24h>" "$<TARGET_FILE:database_tests>"
            --identity-test "$<TARGET_FILE:identity_mapping_tests>")
        set_tests_properties(accounts.identity_mapping.process PROPERTIES TIMEOUT 120
            ENVIRONMENT "PATH=/usr/sbin:/usr/bin:/sbin:/bin:$ENV{PATH}")
        add_test(NAME accounts.registration.process COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/database_process_tests.py"
            "$<TARGET_FILE:dc24h>" "$<TARGET_FILE:database_tests>"
            --registration-test "$<TARGET_FILE:registration_tests>")
        set_tests_properties(accounts.registration.process PROPERTIES TIMEOUT 120
            ENVIRONMENT "PATH=/usr/sbin:/usr/bin:/sbin:/bin:$ENV{PATH}")
        add_test(NAME accounts.repository.process COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/database_process_tests.py"
            "$<TARGET_FILE:dc24h>" "$<TARGET_FILE:database_tests>"
            --account-test "$<TARGET_FILE:account_repository_tests>")
        set_tests_properties(accounts.repository.process PROPERTIES TIMEOUT 120
            ENVIRONMENT "PATH=/usr/sbin:/usr/bin:/sbin:/bin:$ENV{PATH}")
        add_test(NAME accounts.webadmin.process COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/database_process_tests.py"
            "$<TARGET_FILE:dc24h>" "$<TARGET_FILE:database_tests>"
            --account-webadmin-test "$<TARGET_FILE:dc24h-account-admin>" "$<TARGET_FILE:account_webadmin_tests>")
        set_tests_properties(accounts.webadmin.process PROPERTIES TIMEOUT 180
            ENVIRONMENT "PATH=/usr/sbin:/usr/bin:/sbin:/bin:$ENV{PATH}")
        add_test(NAME database.process COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/database_process_tests.py"
            "$<TARGET_FILE:dc24h>" "$<TARGET_FILE:database_tests>")
        add_test(NAME database.core.process COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/database_process_tests.py"
            "$<TARGET_FILE:dc24h>" "$<TARGET_FILE:database_tests>" "$<TARGET_FILE:database_core_tests>")
        add_test(NAME database.resilience.process COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/database_process_tests.py"
            "$<TARGET_FILE:dc24h>" "$<TARGET_FILE:database_tests>"
            --resilience-test "$<TARGET_FILE:database_resilience_tests>")
        set_tests_properties(database.resilience.process PROPERTIES TIMEOUT 150
            ENVIRONMENT "PATH=/usr/sbin:/usr/bin:/sbin:/bin:$ENV{PATH}")
        add_test(NAME database.migrations.process COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/database_process_tests.py"
            "$<TARGET_FILE:dc24h>" "$<TARGET_FILE:database_tests>"
            --migration-test "$<TARGET_FILE:database_migrations_tests>")
        set_tests_properties(database.migrations.process PROPERTIES TIMEOUT 120
            ENVIRONMENT "PATH=/usr/sbin:/usr/bin:/sbin:/bin:$ENV{PATH}")
        set_tests_properties(database.core.process PROPERTIES TIMEOUT 120
            ENVIRONMENT "PATH=/usr/sbin:/usr/bin:/sbin:/bin:$ENV{PATH}")
        set_tests_properties(database.process PROPERTIES TIMEOUT 120
            ENVIRONMENT "PATH=/usr/sbin:/usr/bin:/sbin:/bin:$ENV{PATH}")
    elseif(DC24H_REQUIRE_INTEGRATION_TESTS)
        message(FATAL_ERROR "Required MariaDB server/client tools missing: database.process unavailable")
    else()
        message(STATUS "MariaDB server/client tools missing: database.process unavailable")
    endif()
    add_executable(api_tests tests/api_tests.cpp)
    target_link_libraries(api_tests PRIVATE dc24h_api)
    target_compile_options(api_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    add_test(NAME api.unit COMMAND api_tests)
    add_test(NAME api.process COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/api_process_tests.py" "$<TARGET_FILE:dc24h>")
    set_tests_properties(api.unit api.process PROPERTIES TIMEOUT 45)
    find_program(APACHE2_EXECUTABLE apache2 PATHS /usr/sbin)
    find_path(APACHE2_MODULE_DIR NAMES mod_ssl.so PATHS /usr/lib/apache2/modules)
    if(APACHE2_EXECUTABLE AND APACHE2_MODULE_DIR)
        add_test(NAME apache2.https COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/apache_https_tests.py"
            "${APACHE2_EXECUTABLE}" "${APACHE2_MODULE_DIR}"
            "${CMAKE_CURRENT_SOURCE_DIR}/config/apache2-webadmin-https.conf.example")
        set_tests_properties(apache2.https PROPERTIES TIMEOUT 60)
        if(EXISTS "${APACHE2_MODULE_DIR}/mod_proxy_http.so")
            add_test(NAME apache2.https.proxy COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/apache_https_proxy_tests.py"
                "${APACHE2_EXECUTABLE}" "${APACHE2_MODULE_DIR}"
                "${CMAKE_CURRENT_SOURCE_DIR}/config/apache2-webadmin-https-proxy.conf.example")
            set_tests_properties(apache2.https.proxy PROPERTIES TIMEOUT 90)
            add_test(NAME apache2.remote.gateway COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/apache_remote_gateway_tests.py"
                "${APACHE2_EXECUTABLE}" "${APACHE2_MODULE_DIR}"
                "${CMAKE_CURRENT_SOURCE_DIR}/config/apache2-webadmin-remote.conf.example")
            set_tests_properties(apache2.remote.gateway PROPERTIES TIMEOUT 90)
        elseif(DC24H_REQUIRE_INTEGRATION_TESTS)
            message(FATAL_ERROR "Required Apache2 mod_proxy_http not found: apache2.https.proxy unavailable")
        else()
            message(STATUS "Apache2 mod_proxy_http not found: apache2.https.proxy unavailable")
        endif()
    elseif(DC24H_REQUIRE_INTEGRATION_TESTS)
        message(FATAL_ERROR "Required Apache2/mod_ssl not found: apache2.https unavailable")
    else()
        message(STATUS "Apache2/mod_ssl not found: apache2.https unavailable")
    endif()
    find_program(SYSTEMD_ANALYZE_EXECUTABLE systemd-analyze)
    find_program(SYSTEMD_RUN_EXECUTABLE systemd-run)
    find_program(SYSTEMD_SYSUSERS_EXECUTABLE systemd-sysusers)
    if(SYSTEMD_ANALYZE_EXECUTABLE AND SYSTEMD_RUN_EXECUTABLE AND SYSTEMD_SYSUSERS_EXECUTABLE)
        add_test(NAME systemd.sandbox COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/systemd_sandbox_tests.py"
            "$<TARGET_FILE:dc24h>"
            "${CMAKE_CURRENT_SOURCE_DIR}/config/dc24h.service.example"
            "${CMAKE_CURRENT_SOURCE_DIR}/config/dc24h.sysusers.example")
        set_tests_properties(systemd.sandbox PROPERTIES TIMEOUT 60)
    elseif(DC24H_REQUIRE_INTEGRATION_TESTS)
        message(FATAL_ERROR "Required systemd tools missing: systemd.sandbox unavailable")
    else()
        message(STATUS "systemd tools missing: systemd.sandbox unavailable")
    endif()
    find_program(NCDC_EXECUTABLE ncdc)
    if(NCDC_EXECUTABLE)
        if(MARIADBD_EXECUTABLE AND MARIADB_INSTALL_DB_EXECUTABLE AND MARIADB_CLIENT_EXECUTABLE AND MARIADB_ADMIN_EXECUTABLE)
            add_test(NAME database.ncdc.process COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/database_process_tests.py"
                "$<TARGET_FILE:dc24h>" "$<TARGET_FILE:database_tests>" "$<TARGET_FILE:database_core_tests>"
                "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>")
            set_tests_properties(database.ncdc.process PROPERTIES TIMEOUT 120
                ENVIRONMENT "PATH=/usr/sbin:/usr/bin:/sbin:/bin:$ENV{PATH}")
        endif()
        add_test(NAME adc.security.ncdc COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_negotiation_test.py"
            "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}")
        add_test(NAME adcs.security.ncdc COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_negotiation_test.py"
            "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" --tls)
        set_tests_properties(adc.security.ncdc adcs.security.ncdc PROPERTIES TIMEOUT 30)
        add_test(NAME adc.status.ncdc COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_status_test.py"
            "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}")
        add_test(NAME adcs.status.ncdc COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_status_test.py"
            "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" --tls)
        set_tests_properties(adc.status.ncdc adcs.status.ncdc PROPERTIES TIMEOUT 30)
        add_test(NAME adc.identity.ncdc COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_sup_test.py"
            "$<TARGET_FILE:adc_identity_tests>" "${NCDC_EXECUTABLE}" --identity)
        set_tests_properties(adc.identity.ncdc PROPERTIES TIMEOUT 30)
        add_test(NAME adc.inf.ncdc COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_sup_test.py"
            "$<TARGET_FILE:adc_inf_tests>" "${NCDC_EXECUTABLE}" --inf)
        set_tests_properties(adc.inf.ncdc PROPERTIES TIMEOUT 30)
        add_test(NAME adc.sid.ncdc COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_sup_test.py"
            "$<TARGET_FILE:adc_sid_tests>" "${NCDC_EXECUTABLE}" --sid)
        set_tests_properties(adc.sid.ncdc PROPERTIES TIMEOUT 30)
        add_test(NAME adc.sup.ncdc COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_sup_test.py"
            "$<TARGET_FILE:adc_sup_tests>" "${NCDC_EXECUTABLE}")
        set_tests_properties(adc.sup.ncdc PROPERTIES TIMEOUT 30)
        add_test(NAME adc.ncdc COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
            "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>")
        add_test(NAME adcs.ncdc COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
            "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>" --tls)
        set_tests_properties(adc.ncdc adcs.ncdc PROPERTIES TIMEOUT 30)
        add_test(NAME adc.tth.ncdc COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
            "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>" --tth)
        add_test(NAME adcs.tth.ncdc COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
            "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>" --tth --tls)
        set_tests_properties(adc.tth.ncdc adcs.tth.ncdc PROPERTIES TIMEOUT 30)
        add_test(NAME adc.feature.ncdc COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
            "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>" --feature)
        add_test(NAME adcs.feature.ncdc COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
            "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>" --feature --tls)
        set_tests_properties(adc.feature.ncdc adcs.feature.ncdc PROPERTIES TIMEOUT 45)
        add_test(NAME adc.activepassive.ncdc COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
            "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>" --active-passive)
        add_test(NAME adcs.activepassive.ncdc COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
            "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>" --active-passive --tls)
        set_tests_properties(adc.activepassive.ncdc adcs.activepassive.ncdc PROPERTIES TIMEOUT 60)
        add_test(NAME adcs.activepassive.bindscope.ncdc COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
            "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>"
            --active-passive --tls --port-scope-conflict)
        add_test(NAME adcs.capabilities.bindscope.ncdc COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
            "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>"
            --client-capabilities --peer-tls --tls --port-scope-conflict)
        set_tests_properties(adcs.activepassive.bindscope.ncdc adcs.capabilities.bindscope.ncdc PROPERTIES TIMEOUT 60)
        add_test(NAME adc.searchsecurity.ncdc COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
            "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>" --search-security)
        add_test(NAME adcs.searchsecurity.ncdc COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
            "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>" --search-security --tls)
        set_tests_properties(adc.searchsecurity.ncdc adcs.searchsecurity.ncdc PROPERTIES TIMEOUT 45)
        add_test(NAME adc.transfercore.ncdc COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
            "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>" --transfer-core)
        add_test(NAME adcs.transfercore.ncdc COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
            "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>" --transfer-core --tls)
        set_tests_properties(adc.transfercore.ncdc adcs.transfercore.ncdc PROPERTIES TIMEOUT 45)
        add_test(NAME adc.ctm.ncdc COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
            "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>" --ctm)
        add_test(NAME adcs.ctm.ncdc COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
            "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>" --ctm --tls)
        set_tests_properties(adc.ctm.ncdc adcs.ctm.ncdc PROPERTIES TIMEOUT 45)
        foreach(hub_transport adc adcs)
            set(configuration_hub_flags)
            if(hub_transport STREQUAL "adcs")
                list(APPEND configuration_hub_flags --tls)
            endif()
            add_test(NAME ${hub_transport}.transferconfiguration.ncdc COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
                "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>"
                --ctm --transfer-configuration ${configuration_hub_flags})
            add_test(NAME ${hub_transport}.transferconfiguration.adcs.ncdc COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
                "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>"
                --rcm --peer-tls --transfer-configuration ${configuration_hub_flags})
            set_tests_properties(${hub_transport}.transferconfiguration.ncdc ${hub_transport}.transferconfiguration.adcs.ncdc PROPERTIES TIMEOUT 60)
        endforeach()

        add_test(NAME adc.rcm.ncdc COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
            "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>" --rcm)
        add_test(NAME adcs.rcm.ncdc COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
            "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>" --rcm --tls)
        set_tests_properties(adc.rcm.ncdc adcs.rcm.ncdc PROPERTIES TIMEOUT 45)
        add_test(NAME adcs.rcm.terminal.ncdc COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
            "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>" --rcm --tls --terminal-pressure)
        set_tests_properties(adcs.rcm.terminal.ncdc PROPERTIES TIMEOUT 45)
        foreach(command ctm rcm)
            add_test(NAME adc.${command}.adcs.ncdc COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
                "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>" --${command} --peer-tls)
            add_test(NAME adcs.${command}.adcs.ncdc COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
                "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>" --${command} --peer-tls --tls)
            set_tests_properties(adc.${command}.adcs.ncdc adcs.${command}.adcs.ncdc PROPERTIES TIMEOUT 45)
        endforeach()
        foreach(transport adc adcs)
            set(capability_transport_args "")
            if(transport STREQUAL "adcs")
                set(capability_transport_args --tls)
            endif()
            add_test(NAME ${transport}.capabilities.ncdc COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
                "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>"
                --client-capabilities ${capability_transport_args})
            add_test(NAME ${transport}.capabilities.adcs.ncdc COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
                "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>"
                --client-capabilities --peer-tls ${capability_transport_args})
            set_tests_properties(${transport}.capabilities.ncdc ${transport}.capabilities.adcs.ncdc PROPERTIES TIMEOUT 45)
            add_test(NAME ${transport}.tokens.ncdc COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
                "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>"
                --transfer-tokens ${capability_transport_args})
            add_test(NAME ${transport}.tokens.adcs.ncdc COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
                "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>"
                --transfer-tokens --peer-tls ${capability_transport_args})
            set_tests_properties(${transport}.tokens.ncdc ${transport}.tokens.adcs.ncdc PROPERTIES TIMEOUT 45)
            add_test(NAME ${transport}.connectionsecurity.ncdc COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
                "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>"
                --connection-security ${capability_transport_args})
            add_test(NAME ${transport}.connectionsecurity.active.ncdc COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
                "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>"
                --connection-security-active ${capability_transport_args})
            set_tests_properties(${transport}.connectionsecurity.ncdc ${transport}.connectionsecurity.active.ncdc PROPERTIES TIMEOUT 45)
            add_test(NAME ${transport}.transferlimits.ncdc COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
                "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>"
                --transfer-limits ${capability_transport_args})
            set_tests_properties(${transport}.transferlimits.ncdc PROPERTIES TIMEOUT 45)
            add_test(NAME ${transport}.transfererrors.ncdc COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
                "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>"
                --transfer-errors ${capability_transport_args})
            add_test(NAME ${transport}.transfererrors.adcs.ncdc COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/ncdc_login_test.py"
                "$<TARGET_FILE:dc24h>" "${NCDC_EXECUTABLE}" "$<TARGET_FILE:adc_msg_tests>"
                --transfer-errors --peer-tls ${capability_transport_args})
            set_tests_properties(${transport}.transfererrors.ncdc ${transport}.transfererrors.adcs.ncdc PROPERTIES TIMEOUT 45)
        endforeach()
    elseif(DC24H_REQUIRE_INTEGRATION_TESTS)
        message(FATAL_ERROR "Required ncdc not found: adc.ncdc and adcs.ncdc smoke tests are unavailable")
    else()
        message(STATUS "ncdc not found: adc.ncdc and adcs.ncdc smoke tests are unavailable")
    endif()
    set_tests_properties(adc.parser adc.syntax adc.process adc.security PROPERTIES TIMEOUT 30)
    set_tests_properties(core.lifecycle core.process network.unit PROPERTIES TIMEOUT 30)
    set_tests_properties(network.process PROPERTIES TIMEOUT 45)
    if(DC24H_SANITIZER STREQUAL "address")
        set(dc24h_sanitizer_runtime
            "ASAN_OPTIONS=set:halt_on_error=1:abort_on_error=1:detect_leaks=1"
            "DC24H_SANITIZER=set:address")
    elseif(DC24H_SANITIZER STREQUAL "undefined")
        set(dc24h_sanitizer_runtime
            "UBSAN_OPTIONS=set:halt_on_error=1:abort_on_error=1:print_stacktrace=1"
            "DC24H_SANITIZER=set:undefined")
    elseif(DC24H_SANITIZER STREQUAL "thread")
        set(dc24h_sanitizer_runtime
            "TSAN_OPTIONS=set:halt_on_error=1:abort_on_error=1:suppressions=${CMAKE_SOURCE_DIR}/cmake/thread_sanitizer.supp"
            "DC24H_SANITIZER=set:thread")
    else()
        set(dc24h_sanitizer_runtime "")
    endif()
    if(dc24h_sanitizer_runtime)
        get_property(dc24h_tests DIRECTORY PROPERTY TESTS)
        if(dc24h_tests)
            set_tests_properties(${dc24h_tests} PROPERTIES ENVIRONMENT_MODIFICATION "${dc24h_sanitizer_runtime}")
        endif()
    endif()
endif()
