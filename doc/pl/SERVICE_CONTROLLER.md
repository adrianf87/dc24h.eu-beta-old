# Kontroler usługi huba (tylko odczyt) — beta-0.1.5

Ta wersja dodaje **niezależny proces C++20** `dc24h-service-controller`. Działa także przy zatrzymanym hubie ADC/ADCS, bez serwisowego API HTTP i bez MariaDB. Nie uruchamia, zatrzymuje ani restartuje usług. Nie jest zdalnym API zarządzania.

## Architektura i granica zaufania

1. Uprawniony proces lokalny otwiera gniazdo strumieniowe Unix `/run/dc24h-control/status.sock`. Katalog ma właściciela będącego użytkownikiem kontrolera oraz tryb `0750`; gniazdo ma tryb `0660` i grupę podstawową kontrolera `dc24h-admin`. Dodatkowo kontroler odczytuje `SO_PEERCRED`: UID klienta musi być identyczny z UID kontrolera albo **główna GID** klienta musi odpowiadać głównej GID kontrolera. Samo członkostwo w grupie dodatkowej nie wystarczy. Użytkownika huba ani niezaufanego procesu nie wolno przydzielać do tej grupy.
2. Jedyny prawidłowy komunikat to bajty ASCII `STATUS\n` (wraz z LF), o długości maksymalnej 32 bajtów. Nieznane, dodatkowe, niekompletne i sterujące żądania są odrzucane. Odpowiedź stanowi jedna linia JSON (schemat 1). Klient nie może podawać tokenu, ścieżki, nazwy usługi, PID ani polecenia powłoki. Odczyt i zapis gniazda mają dwusekundowe limity.
3. Kontroler uruchamia wyłącznie stałe polecenie `/usr/bin/systemctl --system --no-pager show --property=LoadState,ActiveState,SubState,Result,MainPID dc24h.service` przez `fork`/`execve`, bez powłoki, w minimalnym środowisku. Wyjście ma limit 4096 bajtów i czas 2 sekund. Wartości są ograniczone do małych liter oraz myślników; nie są przekazywane bez walidacji. Odpowiedź nie zawiera ścieżek do plików jednostek, dziennika, zmiennych środowiskowych ani sekretów.
4. Katalog gniazda jest sprawdzany z `O_NOFOLLOW`, kontrolą UID właściciela i zakazem zapisu dla grupy oraz innych użytkowników. Symlinki i obce pliki są odrzucane, drugi kontroler nie może wyprzeć działającego. Przy zwykłym SIGTERM/SIGINT usuwane jest tylko gniazdo utworzone przez dany proces. Kompilacja nie instaluje i nie włącza usługi ani nie zakłada kont systemowych.

Przykład odpowiedzi, gdy systemd jest dostępny (rzeczywiste wartości mogą być inne):

```json
{"schema":1,"available":true,"unit":"dc24h.service","load_state":"loaded","active_state":"inactive","sub_state":"dead","result":"success"}
```

Brak dostępu do systemd daje `{"schema":1,"available":false,"error":"systemd_unavailable"}`. Niepoprawna odpowiedź menedżera daje `invalid_systemd_response`. Nie należy z tych błędów wnioskować o rzeczywistym stanie huba. Żaden wariant nie uruchamia huba.

## Wdrożenie lokalne (po ręcznym przeglądzie)

- Sprawdź [config/dc24h-control.sysusers.example](../../config/dc24h-control.sysusers.example) i [config/dc24h-control.service.example](../../config/dc24h-control.service.example). Utwórz odrębnego użytkownika `dc24h-control` i grupę `dc24h-admin` zgodnie z polityką systemu; ogranicz członkostwo. Nie wykorzystuj konta huba ADC ani procesu internetowego.
- Po przeglądzie zainstaluj skompilowany program, dostosuj ścieżkę wykonywalną w przykładzie i skopiuj jednostkę do katalogu `systemd`. Kompilacja nie aktywuje jednostki. Zmiany w konfiguracji systemowej podlegają przeglądowi przed `systemctl daemon-reload` oraz `enable --now`.
- Do sprawdzenia ręcznego uruchom `dc24h-service-controller --socket /run/dc24h-control/status.sock` w osobnym, ograniczonym kontekście usługi. Uprawniony lokalny klient wysyła dosłowne `STATUS\n`. Sprawdź zachowanie przy zatrzymanym `dc24h.service` oraz przy braku systemd. Kontroler ma odpowiadać niezależnie od huba.
- Grupa daje dostęp **wyłącznie do odczytu stanu**. W tej wersji nie istnieją połączenie z `hub.manage`, trasa WebAdmin, tłumaczenie grantu roli, polecenie sterujące, uprzywilejowana metoda D-Bus ani reguła Polkit. Członkostwo w grupie nie odpowiada roli Owner. Przed beta-0.1.6 konieczny jest odrębny, serwerowy mechanizm przekazywania uprawnienia Owner, lista dozwolonych operacji, limity, weryfikacja wyniku i audyt. Członkostwo w grupie nie może wystarczyć do sterowania usługą.

## Testy i ograniczenia

Poprawka po audycie: prawidłowy `STATUS\n` może dotrzeć kilkoma fragmentami strumienia Unix; kontroler odczytuje je w jednym limicie 2 sekund i nadal odrzuca dodatkowe lub błędne bajty. Istniejące gniazdo jest usuwane jako nieaktywne wyłącznie po jednoznacznym błędzie `ECONNREFUSED`. Odmowa dostępu i inne niepewne błędy pozostawiają gniazdo bez zmian. Testy regresyjne obejmują oba przypadki.

`service.controller.process` sprawdza odpowiedź bez uruchamiania huba, odrzucanie komend sterujących, drugą instancję, usuwanie gniazda, symlink, niebezpieczne uprawnienia katalogu i numer wersji. Dostępność prawdziwego systemd zależy od środowiska; testy nie zmieniają `dc24h.service` na hoście. Przykładowa jednostka nie jest automatycznie instalowana ani testowana na środowisku produkcyjnym. Nie zmieniają się ADC/ADCS, API serwisowe, Apache, przyciski WebAdmin, schemat MariaDB v10 ani audyt. Uprawnienie aplikacyjne `hub.manage` pozostaje niezaimplementowane. Start/Stop/Restart z kontrolą Owner i audytem to beta-0.1.6; przyciski WebAdmin to beta-0.1.7.
