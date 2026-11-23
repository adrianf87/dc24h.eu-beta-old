# Beta 0.4.5–0.4.8 — Etap II: Passkeys i zarządzanie urządzeniami

Prace rozwojowe dla [Issue #221](https://github.com/adrianf87/dc24h.eu-high-starter/issues/221).
To **nie jest** wdrożenie produkcyjne, uprawnienie do udostępnienia panelu
publicznie ani zgoda na pominięcie obowiązkowych kontroli CI przed scaleniem.

## Patche

- **beta-0.4.5 — WebAuthn Foundation:** stały HTTPS Origin i RP ID,
  biblioteka weryfikacyjna, prywatny trwały katalog kluczy publicznych,
  liczniki, stany kopii zapasowych i testy kryptograficzne.
- **beta-0.4.6 — Passkey Enrollment:** rejestracja do ośmiu kluczy dla aktywnego
  administratora/Ownera po świeżym logowaniu; CSRF, jednorazowe wyzwanie,
  kontrola uprawnień, UP/UV i audyt.
- **beta-0.4.7 — Passkey Login:** hasło konta **plus passkey zamiast TOTP**,
  poprawna weryfikacja pochodzenia, RP ID, podpisu i licznika, sesja dopiero
  po sprawdzeniu klucza.
- **beta-0.4.8 — Device & Recovery:** lista i nazwy urządzeń, odwołanie
  klucza kończące sesje konta oraz kontrolowana procedura awaryjna offline.

**Ograniczenie:** obecny C++ API wydaje uprawnienia po weryfikacji hasła.
Dlatego jest to logowanie **hasło + passkey**, a nie logowanie bezhasłowe.
Hasło nadal sprawdza C++ wraz z rolą i dostępem; drugi składnik jest
odporny na podszywanie się pod obcą domenę. Dotychczasowe hasło+TOTP pozostaje
alternatywą. Nie wolno nazywać tej implementacji bezhasłową.

Hub C++20 ADC/ADCS i MariaDB (schemat v11) pozostają bez zmian. Osobna
brama Node przechowuje wyłącznie identyfikatory poświadczeń, klucze
**publiczne**, uchwyty kont, liczniki, stany backupu, daty i unieważnienia
w pliku chronionym przez system. Nie przyznajemy bramie haseł do MariaDB.
Nie wykonujemy migracji SQL w Etapie II; przyszła migracja wymaga osobnego
projektu, kopii zapasowej i testu cofnięcia.

## Ochrona połączenia i konfiguracja

- Apache2 HTTPS i Node obsługują wyłącznie loopback, opcjonalnie prywatny
  tunel SSH; nadal brak dostępu publicznego i operacji zarządzania hubem.
- Wymagane zmienne: `DC24H_REMOTE_ORIGIN=https://localhost:8443`,
  `DC24H_REMOTE_RP_ID=localhost`,
  `DC24H_REMOTE_PASSKEY_FILE=/var/lib/dc24h-remote/passkeys.json`.
  RP ID musi odpowiadać nazwie hosta HTTPS; nie jest pobierany z nagłówków
  klienta. Zmiana RP ID może wymagać ponownej rejestracji kluczy.
- Katalog danych należy do użytkownika bramy (folder 0700, plik 0600), bez
  dowiązań symbolicznych/twardych. Zmiany są zapisywane atomowo i fsync.
  Wspierany jest tylko jeden aktywny proces zapisujący. Niespójny katalog
  lub uszkodzony audyt skutkuje odmową dostępu.
- POST wymaga ścisłego Origin, CSRF, metod/ścieżek i JSON. Wyjątek 32 KiB
  dotyczy wyłącznie odpowiedzi WebAuthn; zwykłe POST nadal mają limit 2 KiB.
  Ciasteczka to Secure/HttpOnly/SameSite=Strict.
- Wydanie nie uruchamia automatycznie Apache2, systemd, migracji ani
  publicznego portu. Systemy docelowe: Ubuntu 22.04/24.04/26.04 i Debian
  12/13. Serwer odniesienia: Debian 13 Trixie, Xeon D-1521 (8 × 2.7 GHz),
  31 997 MiB RAM.

## Dodawanie klucza i urządzenia

1. Zaloguj się jako aktywny administrator/Owner za pomocą hasła i TOTP
   lub hasła i już zarejestrowanego passkey.
2. W ciągu 60 sekund wybierz **Dodaj passkey**, potwierdź obecność oraz
   weryfikację użytkownika na urządzeniu. Wyzwanie jest jednorazowe.
3. **Odśwież urządzenia** pokazuje klucze tego konta. Nazwa jest tylko
   etykietą, maksymalnie 64 bezpieczne znaki. Zmiana wymaga CSRF i świeżego
   logowania.
4. **Unieważnij** wyłącza konkretny klucz, zapisuje zdarzenia audytu i
   kończy wszystkie sesje konta. Nie przywracaj starego katalogu danych
   bez ponownego przeglądu bezpieczeństwa.

## Awaryjne odzyskiwanie offline

Jeżeli administrator wciąż ma TOTP albo inny klucz, powinien zalogować się
i unieważnić utracony. Gdy stracił wszystkie składniki:

1. Zatrzymaj lokalną bramę i ewentualny tunel SSH. Potwierdź tożsamość
   niezależnym kanałem i uzyskaj zgodę **dwóch różnych operatorów**,
   zapisaną poza aplikacją. Program sam nie weryfikuje prawdziwości zgód.
2. Wykonaj chronioną kopię katalogu passkeys, TOTP, rejestru replay i audytu.
   Utwórz plik JSON z uprawnieniami 0600 w katalogu 0700:

   ```json
   {"schema":1,"actor":"7","approvers":["operator-one","operator-two"]}
   ```

3. Uruchom jako użytkownik usługi, gdy brama jest **zatrzymana**:

   ```sh
   node --import tsx server/remote-passkey-recovery.ts \
     --catalog /var/lib/dc24h-remote/passkeys.json \
     --rp-id localhost --audit /var/lib/dc24h-remote/audit.jsonl \
     --request /private/operator/passkey-recovery.json --offline-ack
   ```

4. Narzędzie zapisuje zdarzenie intencji i wyniku w trwałym audycie oraz
   unieważnia wszystkie aktywne klucze tego konta. W razie błędu zapisu
   zatrzymaj procedurę i zbadaj stan plików; nie zakładaj pełnego sukcesu.
   Jeśli trzeba, odzyskaj TOTP osobną procedurą Etapu I bez zerowania replay.
   Dopiero potem uruchom bramę, sprawdź odrzucanie starych kluczy i dodaj nowe.

## Testy i wydanie

Wykonaj `npm ci`, `npm run typecheck`, `npm test`, `npm run build` i
`npm run test:e2e` w `webadmin`; osobno C++/CTest/sanitizery, testy Apache2
i integrację na Ubuntu/Debian. Testy obejmują poprawny podpis ES256,
odmowę dla obcego Origin/RP ID, zużyte wyzwania, CSRF, liczniki,
uprawnienia, utratę audytu i unieważnienie sesji.

Po każdym pushu zanotuj SHA, PR i stan CI. **Nie czekaj na koniec CI**, aby
zgłosić postęp, ale **nie scalaj ani nie wdrażaj**, dopóki wymagane testy
i przeglądy nie zakończą się pozytywnie. Wydanie beta-0.4.8 nie oznacza
automatycznej zgody na publiczny WebAdmin.
