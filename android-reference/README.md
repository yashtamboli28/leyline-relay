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

---

## 3. Three Edge-Case Failures & How We Recover

1. **Bluetooth Drops Mid-Message (`GATT Error 133`)**: Incoming pieces are saved immediately to a `chunk_staging` SQLite table with a checklist (`bitmask`). On disconnect, we call `gatt.close()` cleanly and reconnect to send **only the missing pieces** instead of starting from scratch.
2. **SQLite Outbox Fills Up**: Outbox storage is capped at `4,096 packets`. **SOS alerts are protected**, so if space runs out, older normal messages with the lowest `TTL` left are deleted first.
3. **Infinite Message Loops (`A -> B -> C -> A`)**: Every phone saves seen `Message ID`s in a `seen_packets` table and ignores duplicates immediately. Combined with `TTL` counting down to `0` and a small `60–340ms` random broadcast delay, message storms cannot happen.

---

## 4. Physical 3-Phone Test Log (Airplane Mode ON)

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

## 5. Tool & Library Disclosure (100% Offline, Zero Cloud)

* **Native Android BLE**: `BluetoothLeScanner`, `BluetoothLeAdvertiser`, `BluetoothGatt`, `BluetoothGattServer`, `ForegroundService` (`connectedDevice`).
* **Local Storage & Code**: Jetpack Room SQLite (`WAL` mode), Kotlin Coroutines, `ByteBuffer`, `java.security` (`Ed25519`).
* **Zero Cloud Guarantee**: Zero Firebase/Play Services SDKs and **`android.permission.INTERNET` is completely omitted from `AndroidManifest.xml`**.
