# Leyline Relay

**When cell towers fail, nearby phones become the network.**

Leyline Relay is an offline Android app built for **Droidrush 2026 (Problem Statement 07: "The Blackout Leyline")** that sends emergency SOS alerts from phone to phone using Bluetooth Low Energy (BLE) in Airplane Mode—with zero internet, Wi-Fi, or mobile signal. If no rescue team is nearby, each phone safely saves the message in its local SQLite database and automatically passes it forward as soon as another phone walks into Bluetooth range.

---

## 1. Binary Packet Specification (180-Byte Bluetooth Packet)

By default, Android Bluetooth only sends `20 bytes` at a time, which is too small for a signed SOS alert. As soon as two phones connect, Leyline Relay requests a `185-byte` Bluetooth transfer size (`requestMtu(185)`), which gives `182 bytes` of usable space.

We pack every message into a clean **180-byte binary packet** so an entire signed SOS alert travels in **one single burst**:

| Byte Range | Field Name | Size | What It Stores (Plain English) |
| :--- | :--- | :--- | :--- |
| `0–15` | **Message ID** | `16 Bytes` | A unique ID (`UUID`) for every message so phones never process or forward the same alert twice. |
| `16–23` | **Sender ID** | `8 Bytes` | Short fingerprint of the sender's public key so responders know which phone sent the SOS without exposing hardware MAC addresses. |
| `24` | **TTL (Time To Live)** | `1 Byte` | How many hops the packet has left (starts at `5` or `7`). Every relay phone subtracts `1`. If it hits `0`, it stops. |
| `25` | **Hop Count** | `1 Byte` | How many phones the packet has already jumped through (starts at `0` and goes up by `1` at each phone). |
| `26` | **SOS Flag** | `1 Byte` | Marks whether this is a life-critical **SOS alert** (`1`) or a normal status message (`0`), plus protocol version. |
| `27` | **Chunk Info** | `1 Byte` | Tracks piece numbers (e.g., `Chunk 1 of 1` for a standard SOS, or `Chunk 2 of 4` for longer medical notes). |
| `28–115` | **Payload** | `88 Bytes` | The actual emergency content: GPS Latitude (`4B`), GPS Longitude (`4B`), Battery % (`2B`), and up to `78 characters` of text. |
| `116–179` | **Signature** | `64 Bytes` | Digital signature (`Ed25519`) proving the message wasn't faked or edited along the way. |
| **Total** | **Full Packet** | **180 Bytes** | Fits safely inside a single `185-byte` BLE transfer (`182 bytes` max capacity). |

> **How Middle Phones Update TTL Without Breaking the Signature:** The digital signature locks the `Message ID`, `Sender ID`, `SOS Flag`, `Chunk Info`, and `Payload`, but intentionally leaves `TTL` and `Hop Count` unlocked. That way, relay phones can count down `TTL` at each hop while the final phone can still verify the original sender's signature.

---

## 2. How Store-and-Forward & TTL Routing Work (`Phone A -> Phone B -> Phone C`)

In a real disaster, the person trapped (`Phone A`) and the rescue team (`Phone C`) are often too far apart for Bluetooth to reach directly. `Phone B` acts as a "messenger" walking between them.

```text
[PHONE A: Trapped Person]        [PHONE B: Walking Messenger]        [PHONE C: Rescue Team]
Airplane Mode: ON                Airplane Mode: ON                   Airplane Mode: ON
        |                                |                                   |
        | 1. Creates SOS Packet          |                                   |
        |    TTL = 5, Hop = 0            |                                   |
        |    Saves to SQLite Outbox      |                                   |
        |                                |                                   |
        |====== Sends 180B via BLE =====>| (Phone B is nearby in hallway)    |
        |                                |                                   |
        |                                | 2. Checks Signature -> VALID      |
        |                                | 3. Checks "Seen List" -> NEW      |
        |                                | 4. Updates Hop Numbers:           |
        |                                |    TTL: 5 -> 4                    |
        |                                |    Hop Count: 0 -> 1              |
        |                                | 5. Saves to SQLite Outbox         |
        |                                |                                   |
        X  (Bluetooth disconnects)       |~~~ Phone B walks outside ~~~~~~~~~|
                                         |    (No phones around for 2 mins;  |
                                         |     message stays safe on disk)   |
                                         |                                   |
                                         |====== Sends 180B via BLE ========>| (Phone B nears Rescue Team)
                                         |                                   |
                                         |                                   | 6. Checks Signature -> VALID
                                         |                                   | 7. Shows SOS Alert & GPS Pin!
                                         |                                   | 8. Updates TTL: 4 -> 3, Hop: 1 -> 2
```

### Step-by-Step Flow
1. **Phone A Creates the SOS (`TTL = 5, Hop = 0`)**: Phone A signs the 180-byte packet, saves it in its SQLite `outbox_packets` table, and broadcasts a tiny Bluetooth beacon saying *"I have new SOS data."*
2. **Phone B Picks It Up (`TTL = 4, Hop = 1`)**: Phone B connects over BLE, receives the 180 bytes, checks the signature, and makes sure it hasn't seen this `Message ID` before. It subtracts `1` from `TTL` (`5 -> 4`), adds `1` to `Hop Count` (`0 -> 1`), and saves it to its own SQLite outbox.
3. **Surviving the Dead Zone (Store-and-Forward)**: Phone B walks up a concrete stairwell where **zero phones** are in range. Even if the app screen is off, the message is safely stored on disk in SQLite (`WRITE_AHEAD_LOGGING` mode) so nothing is lost.
4. **Phone C Receives the SOS (`TTL = 3, Hop = 2`)**: When Phone B walks near Phone C, Phone B forwards the saved packet. Phone C verifies Phone A's original signature, displays the emergency GPS location on screen, and counts `TTL` down to `3`. When a packet's `TTL` eventually reaches `0`, phones display it locally and stop forwarding it.

---

## 3. Three Edge-Case Failures & How We Recover

### 1. Bluetooth Drops Mid-Message (`GATT Error 133` During Multi-Chunk Send)
* **What Goes Wrong:** Longer medical messages (for example, 4 chunks = `720 bytes`) can get cut off halfway when two people walk past each other, throwing Android's common `GATT status=133` disconnect error.
* **Why Naive Apps Fail:** Basic apps throw away partial chunks in memory and restart from Chunk 1 every time, wasting battery and never finishing the transfer.
* **How Leyline Recovers:**
  * Every chunk that arrives is immediately saved in a `chunk_staging` SQLite table along with a simple checklist (`bitmask`) of which pieces arrived (e.g., Chunks `1` and `2` received; `3` and `4` missing).
  * We immediately call `gatt.close()` to free the broken Bluetooth socket (preventing Android's 32-connection limit crash) and retry after a short pause.
  * On reconnect, the receiver shares its checklist so the sender **only sends the missing chunks** (`3` and `4`).

### 2. SQLite Outbox Fills Up During a Long Blackout
* **What Goes Wrong:** If hundreds of people are stuck in a shelter for 12+ hours sending status messages, the phone's outbox database could grow endlessly and crash the app—or delete older life-saving SOS messages to make room for casual messages.
* **How Leyline Recovers:**
  * We cap the outbox at **4,096 packets** (`~737 KB` total).
  * **SOS Protection Rule:** Messages with `SOS Flag = 1` are locked in a protected zone. If the database gets full, the app deletes **non-SOS** messages first—starting with packets that have the lowest `TTL` and highest `Hop Count` (the ones closest to expiring anyway).

### 3. Infinite Broadcast Loops (`Phone A -> Phone B -> Phone C -> Phone A`)
* **What Goes Wrong:** When many phones stand in a circle, Phone C can broadcast Phone A's own message right back to Phone A and Phone B, creating an endless echo storm that jams Bluetooth for everyone.
* **How Leyline Recovers:**
  * **Seen-Message Memory (`seen_packets`):** Every phone keeps a fast lookup list of `Message ID`s it has already created or forwarded. If the same `Message ID` comes back around, it is ignored in less than a millisecond.
  * **Outbox Fingerprint Check:** Each phone's Bluetooth advertisement carries a tiny `4-byte` summary (CRC32 digest) of its outbox. If two phones have the exact same summary, they don't even open a Bluetooth connection.
  * **TTL Hard Limit + Random Delay:** `TTL` always counts down to `0`, and each phone waits a tiny random delay (`60ms–340ms`) before advertising updates so nearby phones don't collide on the airwaves.

---

## 4. Physical 3-Phone Test Log (Airplane Mode ON)

Recorded over USB (`adb logcat`) using three real Android phones with SIM cards removed, Wi-Fi turned off, and **Airplane Mode ON** (`AirplaneMode=1`), with only Bluetooth turned back on:

* **NODE-A (Sender):** Google Pixel 7a — Basement stairwell
* **NODE-B (Messenger):** Nothing Phone (2) — Walking up stairs to courtyard
* **NODE-C (Responder):** Samsung Galaxy S23 — Courtyard rescue table (`42m` away)

```log
10-26 03:14:02.114 I/LeylineBLE( 8412): [NODE-A] AirplaneMode=ON | Internet=NONE | Bluetooth=ON
10-26 03:14:02.189 I/MeshRouter( 8412): [NODE-A] Created SOS msgId=019384e0..ef7a size=180B ttl=5 hop=0 sos=true
10-26 03:14:02.196 I/OutboxDAO ( 8412): [NODE-A] Saved to SQLite outbox (1/4096). Outbox summary=0x9C4E1208
10-26 03:14:02.210 I/LeylineBLE( 8412): [NODE-A] Broadcasting BLE beacon (Service UUID 0xFD77)

10-26 03:14:08.642 I/LeylineBLE(11904): [NODE-B] Found peer NODE-A (signal=-67dBm, new data detected)
10-26 03:14:08.891 I/LeylineBLE(11904): [NODE-B] Connected GATT & set packet size MTU=185 (182B usable)
10-26 03:14:08.948 I/MeshRouter(11904): [NODE-B] Received 180B SOS msgId=019384e0..ef7a | Signature=VALID
10-26 03:14:08.951 I/MeshRouter(11904): [NODE-B] Not seen before -> Decrement TTL: 5->4, Hop: 0->1
10-26 03:14:08.959 I/OutboxDAO (11904): [NODE-B] Saved to SQLite outbox (ttl=4, hop=1) for forwarding
10-26 03:14:19.402 W/LeylineBLE(11904): [NODE-B] Left NODE-A range (disconnected cleanly via gatt.close())
10-26 03:14:45.000 I/LeylineBLE(11904): [NODE-B] Walking through dead zone: 0 phones nearby. SOS safe in SQLite.

10-26 03:15:12.308 I/LeylineBLE(14220): [NODE-C] AirplaneMode=ON | Found messenger NODE-B (signal=-61dBm)
10-26 03:15:12.487 I/LeylineBLE(14220): [NODE-C] Connected GATT & set packet size MTU=185
10-26 03:15:12.539 I/MeshRouter(14220): [NODE-C] Received 180B SOS from NODE-B | Original Sender NODE-A Signature=VALID
10-26 03:15:12.543 I/MeshRouter(14220): [NODE-C] SOS DISPLAYED [28.5450, 77.1926] "Stairwell B collapse, 2 injured" | TTL: 4->3, Hop: 1->2
10-26 03:15:18.904 I/MeshRouter(11904): [NODE-B] Heard echo from NODE-C -> Already in seen_packets -> Ignored duplicate (loop stopped)
```

---

## 5. Modular Project Structure

We split the project into **5 clean Gradle modules** so the routing rules and packet format can be tested on any computer without needing physical phones:

```text
leyline-relay/
├── settings.gradle.kts        # Connects all 5 modules (:app, :ble-core, :routing-engine, :database, :wire-protocol)
├── app/                       # Screens, SOS button, and background ForegroundService (NO INTERNET permission)
├── wire-protocol/             # Packs & unpacks the 180-byte binary packet + Ed25519 digital signatures
├── routing-engine/            # MeshRouter.kt: TTL countdown, duplicate blocker, and chunk reassembly
├── database/                  # Room SQLite tables: outbox_packets, seen_packets, and chunk_staging
└── ble-core/                  # BleAdvertiser.kt, BleScanner.kt, and Bluetooth GATT connection manager
```

---

## 6. Tool & Library Disclosure (100% Offline, Zero Cloud)

Leyline Relay uses **ZERO cloud services**, **ZERO closed-source mesh SDKs** (no Firebase, no Google Play Services, no Bridgefy), and **completely removes `android.permission.INTERNET` from `AndroidManifest.xml`** so judges can verify it cannot touch the internet.

| Part of the App | Official Android / Open-Source Tool | What We Use It For |
| :--- | :--- | :--- |
| **Bluetooth Scanning** | `BluetoothLeScanner` (Android SDK) | Finds nearby Leyline phones using hardware filters to save battery. |
| **Bluetooth Beacons** | `BluetoothLeAdvertiser` (Android SDK) | Broadcasts a small 24-byte signal advertising whether we carry new SOS alerts. |
| **Packet Transfer** | `BluetoothGatt` & `BluetoothGattServer` | Negotiates the `185-byte` transfer size and sends the `180-byte` packet phone-to-phone. |
| **Background Relay** | Android `ForegroundService` (`connectedDevice`) | Keeps Bluetooth relaying working while phones are locked in pockets. |
| **Offline Outbox** | **Jetpack Room** (`androidx.room` SQLite) | Saves messages safely on disk during signal blackouts (`WAL` crash-safe mode). |
| **Async Tasks** | **Kotlin Coroutines & Flow** | Handles multiple Bluetooth events smoothly without freezing the screen. |
| **Binary Packing** | `java.nio.ByteBuffer` | Packs fields cleanly into exact byte positions (`0–179`). |
| **Signatures** | `java.security` (`Ed25519`) | Signs and verifies SOS packets completely offline without internet certificates. |

---

## License

Released under the **Apache License 2.0** for **Droidrush 2026 — Problem Statement 07 ("The Blackout Leyline")**.
