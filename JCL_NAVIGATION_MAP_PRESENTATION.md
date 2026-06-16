# JCL-Gruppen — Navigationskarte (Präsentation)

> Konzeptionelle Struktur für eine zukünftige 3D-Präsentation des Systems.  
> Erstellt auf Basis der technischen Analyse von `index.html` und `app.js`.

---

## Ebene 1 — Eingang / Startseite

```
┌─────────────────────────────────────────────────────────┐
│                   J C L - G R U P P E N                 │
│              Sportauswahl / Startseite                   │
│                                                          │
│   [ Judo ]   [ Karate ]   [ Ringen ]   [ alle Sportarten ] │
│                                                          │
│            → Login für Trainer / Verwaltung              │
│            → Super Admin (versteckter Zugang)            │
└─────────────────────────────────────────────────────────┘
```

---

## Ebene 2 — Rollen-Zonen

Das System hat **4 getrennte Arbeitsbereiche**, jeder mit eigener Logik und eigenem Zugang:

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│              │  │              │  │              │  │              │
│   TRAINER    │  │    ADMIN     │  │ BUCHHALTUNG  │  │ SUPER ADMIN  │
│   Bereich    │  │   Zentrale   │  │   Büro       │  │  Kontrollzentrum │
│              │  │              │  │              │  │              │
│ Training &   │  │ Verwaltung & │  │ Verträge &   │  │ System &     │
│ Schüler      │  │ Statistik    │  │ Finanzen     │  │ Clubs        │
│              │  │              │  │              │  │              │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
```

---

## Ebene 3 — Arbeitsbereiche

### Zone 1: Trainer-Bereich

> Konzept: **Trainings-Halle** — der Ort, wo der tägliche Sportbetrieb läuft.

```
TRAINER-HALLE
│
├── 🟢 HEIMBEREICH — Gruppenauswahl
│       Wählt aktive Trainingsgruppe, sieht Schülerzahl & Genderstatistik
│
├── 📋 ANWESENHEIT — Anwesenheitsliste
│       Markiert Anwesenheit, fügt neue Schüler hinzu
│       Öffnet: Wiegung / Schüler bearbeiten / Schüler Statistik
│
├── ⚖️  WIEGUNG — Gewichtsmessung
│       Erfasst Gewicht pro Schüler für den Wettkampf
│
├── ➕  NEUER SCHÜLER — Aufnahmeformular
│       Name, Geburtsdatum, Gruppe, Foto, Gürtel, Geschlecht
│
├── ✏️  SCHÜLER BEARBEITEN — Bearbeitungsformular
│       Alle Schülerdaten editierbar
│
└── 📊  SCHÜLER STATISTIK
        Trainings pro Woche / Monat / Jahr, Rating, persönliche Infos
```

---

### Zone 2: Admin-Zentrale

> Konzept: **Vereinsbüro** — Verwaltung, Übersicht, Kontrolle über alles.

```
ADMIN-ZENTRALE
│
├── 🏠 DASHBOARD — 9 Karten (Schnellzugang)
│
├── 👥 SCHÜLERLISTE
│       Filter nach Name, Alter, Kyu, OBI, Geschlecht, Sportart
│       ├── ✏️ Schüler bearbeiten
│       ├── 📊 Schüler Statistik
│       └── ⚠️ Ohne Gruppe / ohne Trainer
│
├── 📊 CLUB STATISTIK — Statistik-Zentrale
│       ├── 👤 Trainer Statistik
│       │       └── ✏️ Trainer bearbeiten
│       ├── 🏃 Gruppen Übersicht
│       │       └── ✏️ Gruppe bearbeiten
│       ├── 🎓 Schüler Statistik
│       │       ├── ✏️ Schüler bearbeiten
│       │       └── 📊 Schüler Statistik
│       ├── 📅 Anwesenheit Statistik
│       └── 📈 Zeitraum Statistik
│
├── ➕ NEUE GRUPPE HINZUFÜGEN
│
├── 👤 TRAINER STATISTIK
│       ├── Trainer-Karten mit Gruppen & Schülern
│       └── ✏️ Trainer bearbeiten
│
├── ➕ NEUEN TRAINER HINZUFÜGEN
│
├── 🔐 ADMINISTRATOR & BUCHHALTUNG
│       Benutzerkonten für Admin- und Buchhaltungsrollen
│       ├── ➕ Neuen Admin/Buch hinzufügen
│       └── ✏️ Bearbeiten / Löschen
│
├── 🏅 SPORT MANAGEMENT
│       Sportarten aktivieren, Felder konfigurieren (Kyu/OBI/Gewicht)
│
├── 🖼️  WERBUNG / SPONSOREN
│       Logo-Upload, Popup-Bilder, Anzeige-Modus, Dauer
│
└── 🗑️  KANDIDATEN ZUR LÖSCHUNG
        Archivierte Schüler — endgültig löschen oder wiederherstellen
```

---

### Zone 3: Buchhaltungs-Büro

> Konzept: **Finanzkabinett** — Überblick über Verträge und Zahlungsstatus.

```
BUCHHALTUNGS-BÜRO
│
├── 🏠 DASHBOARD
│       Statistik-Kacheln: ohne Vertrag / archiviert / mit Vertrag
│       Sportart-Filter (Tabs)
│
├── 🔴 NEUE SCHÜLER OHNE VERTRAG
│       Tabelle mit Schülern ohne bestätigten Vertrag
│       Aktion: ✓ Vertrag bestätigen
│       Aktion: 📊 Schüler Statistik öffnen
│
├── 🟡 INAKTIVE / ARCHIVIERTE SCHÜLER
│       Schüler mit offenen Buchhaltungseinträgen
│       Aktion: ✓ Als erledigt markieren
│       Aktion: 📊 Schüler Statistik öffnen
│
└── 🟢 AKTIVE SCHÜLER MIT VERTRAG
        Vollständige Liste aktiver Schüler mit Vertrag
        Aktion: 📊 Schüler Statistik öffnen
```

---

### Zone 4: Super Admin Kontrollzentrum

> Konzept: **Systemzentrale** — plattformweite Kontrolle über alle Clubs und Tarife.

```
SUPER ADMIN KONTROLLZENTRUM
│
├── 🏠 SA DASHBOARD — 3 Hauptbereiche
│
├── 🏢 CLUBS ÜBERSICHT
│       Liste aller registrierten Clubs mit Status, Schüleranzahl, Laufzeit
│       ├── ➕ NEUER CLUB — Registrierungsformular
│       │       club_id, Name, Farben, Billing-Cycle, Kontakt
│       ├── ✏️  CLUB BEARBEITEN
│       │       White-Label-Einstellungen, Vertrags-Details, Aktivierungsstatus
│       └── 🔓 CLUB ÖFFNEN (Impersonation)
│               Wechselt in die Club-Ansicht als SA-Gast
│               [← Zurück zum Super Admin] kehrt zur SA-Zentrale zurück
│
├── 💰 TARIFPAKETE / PREISE
│       Liste aller Tarife mit Preis, Min/Max-Schüler, Währung
│       └── ➕ NEUER TARIF / ✏️ TARIF BEARBEITEN
│
└── 💳 ZAHLUNGEN / ABO
        Zahlungshistorie pro Club, Vertragsstatus, Laufzeit
        └── ➕ ZAHLUNG ERFASSEN (pro Club)
```

---

## Ebene 4 — Detailseiten (gemeinsam genutzt)

Diese Screens werden von mehreren Rollen/Bereichen geöffnet:

| Detailseite | Geöffnet von |
|---|---|
| 📊 Schüler Statistik | Trainer, Admin (Schülerliste, Club Stat), Buchhaltung |
| ✏️ Schüler bearbeiten | Trainer (Anwesenheit), Admin (Schülerliste, Club Stat, Orphan) |
| ✏️ Trainer bearbeiten | Admin (Trainer Stat, Admin Dashboard → Trainer Stat, A&B) |
| ✏️ Gruppe bearbeiten | Admin (Gruppen Übersicht) |

---

## Konzept: 3D-Präsentation

### Raumaufteilung

```
                    ┌──────────────────┐
                    │   STARTSEITE     │  ← Eingang (Foyer)
                    └────────┬─────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
    ┌─────▼──────┐    ┌──────▼─────┐   ┌───────▼──────┐
    │  TRAINER-  │    │   ADMIN-   │   │ BUCHHALTUNGS │
    │   HALLE    │    │  ZENTRALE  │   │    BÜRO      │
    │            │    │            │   │              │
    │ (Sportlich)│    │ (Verwaltg.)│   │ (Finanzen)   │
    └────────────┘    └────────────┘   └──────────────┘

                    ┌──────────────────┐
                    │  SUPER ADMIN     │  ← Dachgeschoss (separater Zugang)
                    │  KONTROLLZENTRUM │
                    └──────────────────┘
```

### Metaphern für die 3D-Visualisierung

| Zone | 3D-Metapher | Farbe | Symbol |
|---|---|---|---|
| Startseite | Vereinseingang / Foyer | Gold `#d4af37` | 🏛️ |
| Trainer-Bereich | Trainings-Dojo / Halle | Blau `#3b82f6` | 🥋 |
| Admin-Zentrale | Vereinsbüro / Leitstelle | Dunkelblau `#1e3a5f` | 🏢 |
| Buchhaltungs-Büro | Finanzkabinett | Grün `#22c55e` | 💼 |
| Super Admin | Systemzentrale / Penthouse | Violett `#7c3aed` | 🔐 |

### Navigation im 3D-Raum

- **Eintreten** = `showPromoTransition` (Promo-Bild = Übergang zwischen Räumen)
- **Zurück** = Tür zurück zum vorherigen Raum
- **Home** = Zurück zum Eingang der eigenen Zone
- **Logout** = Verlassen des Gebäudes (Startseite)

---

## Vollständige Liste aller gefundenen Screens / Funktionen

### Screens (HTML-IDs)
- `sportStartScreen`
- `loginScreen`
- `mainScreen`
- `appBox`
- `groupScreen`
- `attendanceScreen`
- `weightScreen`
- `addStudentScreen`
- `studentStatsScreen`
- `adminScreen`
- `adminStudentScreen`
- `orphanStudentsScreen`
- `clubStatistikScreen`
- `clubStudentStatsScreen`
- `adminStatistikScreen`
- `zeitraumStatistikScreen`
- `trainerAdminScreen`
- `addTrainerScreen`
- `editTrainerScreen`
- `groupOverviewScreen`
- `addGroupScreen`
- `editGroupScreen`
- `adminBuchhaltungScreen`
- `sportManagementScreen`
- `sponsorManagementScreen`
- `deleteCandidatesScreen`
- `buchhaltungScreen`
- `superAdminLoginModal`
- `superAdminScreen`
- `saClubsScreen`
- `saNewClubScreen`
- `saEditClubScreen`
- `saTarifScreen`
- `saTarifFormScreen`
- `saZahlungenScreen`
- `saZahlungFormScreen`

### Navigationsfunktionen (app.js)
- `goHome()` — Logout
- `goRoleHome()` — Rollen-Home
- `goBack()` — Zurück
- `showAdminStudentScreen()`
- `showClubStatistikScreen()`
- `showAddGroup()`
- `showAddTrainer()`
- `showAdminBuchhaltungScreen()`
- `showSportManagementScreen()`
- `showSponsorManagementScreen()`
- `showDeleteCandidatesScreen()`
- `showGroupOverviewScreen()`
- `showAdminStatistikCenter()`
- `showZeitraumStatistikScreen()`
- `openTrainerStatistikFromAdmin()`
- `openTrainerStatistikFromClub()`
- `openTrainerStatistikScreen()`
- `openEditSelectedTrainer()`
- `openEditTrainerFromAdminBuch()`
- `backToTrainerStatistik()`
- `backToGroupOverview()`
- `openSelectedGroupList()` — Anwesenheit
- `showWeight()`
- `openAddStudentForm()`
- `cancelAddStudentForm()`
- `editStudent()`
- `cancelStudentEditForm()`
- `showStudentStats()`
- `showOrphanStudentsList()`
- `openClubStudentStatsFromClub()`
- `showAddAdminBuchForm()`
- `saExitImpersonation()`
- `showSAClubsScreen()`
- `hideSAClubsScreen()`
- `showSANewClubScreen()`
- `hideSANewClubScreen()`
- `showSAEditClubScreen()`
- `hideSAEditClubScreen()`
- `showSATarifScreen()`
- `hideSATarifScreen()`
- `showSATarifFormNew()`
- `hideSATarifForm()`
- `showSAZahlungenScreen()`
- `hideSAZahlungenScreen()`
- `showSAZahlungForm()`
- `hideSAZahlungForm()`

---

## Offene Punkte / zu prüfen

| # | Punkt |
|---|---|
| 1 | `showSAEditClubScreen()` und `showSAZahlungForm()` — navigateWithPromo fehlt möglicherweise bei den Aufrufen in den SA-Karten |
| 2 | Beim Öffnen eines Clubs aus SA (Impersonation-Einstieg) — kein promo beim Betreten, nur beim Verlassen |
| 3 | `goBackScreen()` (separate Funktion mit screenHistory) — wird sie noch aktiv genutzt? |
| 4 | `addStudentScreen` — Öffnung aus Trainer-Kontext via showPromoTransition ✓, aber aus Admin-Kontext zu prüfen |
| 5 | Screens `editStudentScreen` existiert nicht als eigene ID — editStudent() lädt Formular in einen vorhandenen Screen (inline) |
