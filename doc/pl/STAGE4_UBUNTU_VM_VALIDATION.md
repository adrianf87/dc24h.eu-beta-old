# Etap IV: izolowane testy Linuksa w Dockerze

Pierwotna gałąź `test/stage4-ubuntu-vm-validation` powstała na podstawie `main`
po scaleniu etapu IV (beta-0.4.13–0.4.16). Testy znajdują się już w repozytorium;
nie wdrażają usług, nie udostępniają WebAdmin i nie zatwierdzają wydania.

## Własny runner Debian 13 z pięcioma dystrybucjami w kontenerach

Workflow [Stage IV isolated Linux Docker validation](../../.github/workflows/stage4-ubuntu-vm-validation.yml)
uruchamia jednakowy zestaw w kontenerach Docker Debian **12/13** oraz Ubuntu
**22.04/24.04/26.04** na runnerze Linux x64 `server-747585786`. Każdy kontener ma
szesnaście logicznych wątków CPU oraz limit 32 GiB RAM, bez limitu czasu CPU.
Każde środowisko:

1. Instaluje narzędzia C++20, MariaDB, OpenSSL i Apache2 za pomocą instalatora
   z limitami czasu dla repozytoriów apt.
2. Kompiluje serwer w konfiguracji Release oraz testy integracyjne.
3. Wykonuje kopię, odtwarzanie, migracje i testy awarii na **tymczasowej
   MariaDB**, dostępnej tylko przez prywatny Unix socket.
4. Sprawdza **lokalny Apache2/HTTPS**, odmowy dostępu, API i TLS dla ADCS.
5. Uruchamia rzeczywisty serwer ADC/ADCS jedynie pod `127.0.0.1`, z losowymi
   portami i jednorazowym certyfikatem localhost; wykonuje 12 ograniczonych
   prób na protokół z weryfikacją certyfikatu ADCS.
6. Buduje WebAdmin (React, TypeScript, Vite), instaluje Chromium oraz uruchamia
   testy przeglądarkowe E2E, jednostkowe i integrację z rzeczywistym API C++.

Niepoufne wyniki opóźnień oraz raport CTest JUnit są przechowywane jako
artefakt `stage4-linux-docker-<image>` przez 7 dni.

## Wyniki i ograniczenia

Wykonanie testów PR jest ograniczone do użytkownika `adrianf87` i gałęzi
znajdujących się w tym repozytorium (bez forków). Każdy kontener ma limit
90 minut; instalator apt ma osobne limity czasu. **Wszystkie
pięć zadań musi zakończyć się sukcesem**. Test wiszący, przerwany lub
nieuruchomiony nie jest zaliczony. Workflow sam niczego nie scala ani nie wdraża.

Pomiar ADC/ADCS (12 połączeń przy 4/s) jest testem kontrolnym, **nie** testem
wydajności docelowego procesora Intel Xeon D-1521 i 31 997 MiB RAM.

Wyniki kontenerów Debian/Ubuntu na własnym hoście Linux **nie zastępują** pomiarów
rzeczywiście uruchomionych usług docelowych,
odtwarzania produkcyjnej kopii MariaDB z potwierdzonym RPO/RTO, niezależnego
audytu bezpieczeństwa ani ręcznej zgody na wydanie. Niezamknięte wymagania
pozostają w [Issue #223](https://github.com/adrianf87/dc24h.eu-high-starter/issues/223).

Nie używać publicznego huba, wspólnej bazy ani prawdziwych danych administratora
do tych testów.
