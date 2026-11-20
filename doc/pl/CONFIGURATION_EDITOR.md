# Edytor konfiguracji WebAdmin — beta-0.1.4

Ten etap łączy **lokalne API serwisowe beta-0.1.3** ze stroną Konfiguracja w WebAdmin. Nie zmienia zapisu INI w C++, schematu MariaDB v10, ustawień działającego huba ani systemd. Edytor działa wyłącznie z oddzielnym procesem `dc24h-account-admin` na skonfigurowanym gnieździe Unix. Najpierw zatrzymaj hub.

## Procedura operatora

1. Wykonaj niezależne kopie INI/bazy, zatrzymaj hub i sprawdź prywatny INI przez `--check-config`. Zastosuj migrację v10 przed włączeniem oddzielnego procesu administracyjnego.
2. Otwórz WebAdmin dostępny **wyłącznie lokalnie**. Potwierdź aktywne konto Administratora lub Ownera w **Administracja**. Krótkotrwały grant, sesja i CSRF istnieją tylko w pamięci strony, bez zapisu w magazynie przeglądarki.
3. Wybierz **Konfiguracja → Edytor konfiguracji serwisowej** i wczytaj INI. Pola: `network_max_connections` (1–65535), `network_idle_timeout` (1–86400 sekund), `logging_level` (`info`, `warning`, `error`, `off`) oraz `general_language` (`us`, `pl`). Wartości zapisane i startowe procesu serwisowego są rozdzielone; żadna nie opisuje aktywnego huba.
4. Edytuj i kliknij **Waliduj i pokaż podgląd**. Parser C++ sprawdza propozycję i niejawną rewizję HMAC bez zapisu. Podgląd zawiera tylko zmienione klucze, a kolejna edycja go unieważnia.
5. Potwierdź sprawdzone różnice i wybierz **Zapisz konfigurację**. Zapis atomowy tworzy prywatną kopię jednej poprzedniej wersji. Możesz też potwierdzić **Przywróć kopię**, odtwarzając poprzedni INI i zachowując kopię cofnięcia. Po przywróceniu odśwież dane.
6. Sprawdź wynikowy INI, zakończ serwis i uruchom hub ponownie zgodnie z dotychczasową kontrolowaną procedurą. Edytor nie steruje usługą.

## Granica bezpieczeństwa

Przykładowy Apache zachowuje `Require local` oraz dokładną kontrolę hosta, pochodzenia, metody, formularza i ścieżki. Dopuszcza wyłącznie GET/POST `/admin-api/v1/management/configuration` oraz POST `/admin-api/v1/management/configuration/write` lub `/restore`. Adapter Node na localhost weryfikuje grant/sesję/CSRF, dodaje własny bearer procesu na gnieździe Unix, filtruje każdą odpowiedź i odrzuca nieoczekiwane ścieżki/parametry. C++ za każdym razem sprawdza aktywną rolę i `configuration.manage`. Nie usuwaj ograniczeń localhost i nie udostępniaj publicznego panelu administracji zdalnej.

Hasła, tokeny, klucze TLS, ścieżki plików, pełny INI i dowolne klucze nie trafiają do JavaScript. Ogólny kontrakt `management/authorize` pozostaje niezaimplementowany; ograniczony edytor korzysta z oddzielnie autoryzowanych tras.

`409 stale` usuwa starą rewizję — wymagany ponowny odczyt. `422` oznacza odmowę walidacji. Jeśli po zapisie lub przywracaniu zabraknie odpowiedzi (błąd sieci, przekroczenie czasu albo niepoprawna odpowiedź sukcesu), edytor oznacza wynik jako **nieznany** i usuwa zapamiętaną rewizję oraz formularz. Plik INI mógł już zostać zmieniony. Nie ponawiaj operacji: sprawdź INI, `.dc24h.bak`, `.dc24h.undo` oraz audyt. Odmowa dostępu lub wygaśnięcie grantu również czyści wczytaną konfigurację. Jedna generacja kopii nie zastępuje kopii operatora. Każda zmiana wymaga kontrolowanego restartu.

Testy jednostkowe, adaptera, Apache i przeglądarki obejmują walidację, filtrowanie danych, grant/CSRF/pochodzenie, dokładne trasy, podgląd, potwierdzenia oraz PL/US. Przed scaleniem wymagane są pełne CI i CodeQL C++/WebAdmin. Brak przeładowywania na żywo i kontrolera usługi.
