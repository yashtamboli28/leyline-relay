# Leyline Relay

**When towers fall and spectrum goes dark, every pocket becomes a relay tower.**

Leyline Relay is a delay-tolerant, peer-to-peer Bluetooth Low Energy (BLE) mesh network for Android engineered for **Droidrush 2026 — Problem Statement 07 ("The Blackout Leyline")**. It routes cryptographically signed 180-byte SOS packets hop-by-hop in strict Airplane Mode without internet, Wi-Fi, or cellular infrastructure, combining negotiated GATT `WRITE_TYPE_NO_RESPONSE` transport with a Write-Ahead-Logged (WAL) Room SQLite Store-and-Forward outbox to survive radio blackouts and physical node mobility.

---

## 1. Binary Packet Specification (180-Byte Wire Frame)

Android's default BLE ATT Maximum Transmission Unit (MTU) is `23 bytes` (`20 bytes` usable payload), which forces brittle multi-packet fragmentation for signed messages. Upon establishing a link, Leyline Relay immediately negotiates `BluetoothGatt.requestMtu(185)`. Subtracting the `3-byte` ATT Opcode + Attribute Handle header yields **182 bytes** of atomic L2CAP payload capacity.

Every Leyline frame is serialized in deterministic `ByteOrder.BIG_ENDIAN` into an exact **180-byte** wire structure (`2 bytes` below the 182-byte ceiling for alignment safety):

| Byte Offset | Field Name | Size (Bytes) | Wire Type | Engineering Purpose & Validation Invariant |
| :--- | :--- | :--- | :--- | :--- |
| `0x00..0x0F` (`0–15`) | `message_id` | `16` | `UUIDv7 (128-bit)` | Time-ordered unique packet ID (`48-bit` Unix epoch ms + `74-bit` CSPRNG). Primary key for `seen_packets` deduplication. |
| `0x10..0x17` (`16–23`) | `sender_id` | `8` | `UInt64` | First 8 bytes of `SHA-256(Ed25519_PublicKey)`. Identifies origin handset without exposing rotating Android BLE MAC addresses. |
| `0x18` (`24`) | `ttl` | `1` | `UInt8` | Remaining hop budget (`1..15`; default `7` for SOS, `4` for tactical text). Packet is dropped immediately upon ingress if `ttl == 0`. |
| `0x19` (`25`) | `hop_count` | `1` | `UInt8` | Monotonically incremented (`0..15`) by each relay. Enforces invariant `ttl + hop_count <= MAX_DIAMETER (16)` to reject forged headers. |
| `0x1A` (`26`) | `sos_flag` | `1` | `Bitfield8` | `Bit 0`: `IS_SOS` (`1` = life-safety priority, eviction-exempt); `Bit 1`: `ACK_REQ`; `Bits 2..3`: `TRIAGE_CODE`; `Bits 4..7`: `PROTO_VER (0x1)`. |
| `0x1B` (`27`) | `chunk_meta` | `1` | `UInt8` | Packed nibble header: `(chunk_index << 4) \| (total_chunks - 1)`. Single-frame SOS = `0x00` (Chunk `1` of `1`); supports up to `16` chunks (`1,408 B`). |
| `0x1C..0x73` (`28–115`) | `payload` | `88` | `Bytes[88]` | Binary body: `int32` Latitude (`1e-7` deg, `4B`), `int32` Longitude (`1e-7` deg, `4B`), `uint16` Battery/Altitude (`2B`), `78B` UTF-8 emergency text (`0x00` padded). |
| `0x74..0xB3` (`116–179`) | `signature` | `64` | `Ed25519 Sig` | Detached 64-byte signature over **immutable** fields (`message_id + sender_id + sos_flag + chunk_meta + payload`), intentionally excluding mutable `ttl` and `hop_count`. |
| **Total** | **Leyline Wire Chunk** | **180 Bytes** | **Big-Endian** | Single-burst GATT `WRITE_TYPE_NO_RESPONSE` frame inside `185-byte` negotiated ATT MTU. |

> **Zero-Knowledge Relay Authenticity:** Because `ttl` (`0x18`) and `hop_count` (`0x19`) are excluded from the canonical Ed25519 signing pre-image, intermediate nodes mutate hop headers in transit without invalidating the origin handset's cryptographic signature. Any tampering with coordinates, `sos_flag`, or `payload` immediately fails verification at downstream relays.

---

## 2. Store-and-Forward TTL Routing Proof (`Node A -> Node B -> Node C`)

Leyline Relay implements **Delay-Tolerant Networking (DTN)** for disconnected topologies where no simultaneous end-to-end path exists between `Node A` (trapped survivor) and `Node C` (rescue command post). `Node B` acts as an opportunistic data mule.

```text
[NODE A: Trapped Origin]          [NODE B: Mobile Relay Mule]          [NODE C: Rescue Responder]
Airplane Mode: ON                 Airplane Mode: ON                    Airplane Mode: ON
SenderID: 0x8F21A409C311E04A      NodeID:   0x31B7D0884E1029CC         NodeID:   0x99E402A17F66B301
        |                                 |                                    |
        | 1. Mint SOS (MsgID=0193..7A)    |                                    |
        |    TTL=5, Hop=0, SOS=0x11       |                                    |
        |    Sign Ed25519 -> SQLite WAL   |                                    |
        |                                 |                                    |
        |--- BLE Adv (UUID 0xFD77 + ------| (T+00s: Node B enters 18m range)   |
        |    4B Outbox Digest 0x9C4E1208) |                                    |
        |                                 |                                    |
        |<== GATT Connect + MTU=185 ======|                                    |
        |=== Write 180B Frame (TTL=5) ===>|                                    |
        |                                 | 2. Verify Ed25519 Signature: OK    |
        |<-- 17B App-Layer Receipt ACK ---| 3. Check seen_packets(MsgID): NEW  |
        |                                 | 4. Mutate Header:                  |
        |                                 |    TTL = 5 - 1 = 4                 |
        |                                 |    HopCount = 0 + 1 = 1            |
        |                                 | 5. Atomic SQLite WAL Transaction:  |
        |                                 |    INSERT seen_packets(MsgID)      |
        |                                 |    INSERT outbox_packets(TTL=4)    |
        |                                 |                                    |
        X  (T+14s: Link severed;          |~~~ (T+15s..T+190s: Radio Blackout ~|
            Node B walks up stairwell)    |     0 peers visible; packet held   |
                                          |     durably on disk in SQLite WAL) |
                                          |                                    |
                                          |--- BLE Adv (Outbox Digest Updated)>| (T+195s: Node B nears Node C)
                                          |<== GATT Connect + MTU=185 =========|
                                          |=== Write 180B Frame (TTL=4,Hop=1)=>|
                                          |                                    | 6. Verify Ed25519 (Origin A): OK
                                          |<-- 17B App-Layer Receipt ACK ------| 7. Check seen_packets: NEW
                                          | 8. Mark peer_delivered(MsgID, C)   | 9. Render High-Priority SOS Alert
                                          |    Retain in outbox until TTL/Exp  |    Queue forward copy (TTL=3, Hop=2)
```

### State Transition & Persistence Invariants
1. **Origin Commit (`Node A`)**: Packet `019384e0-7b12-7c90-8a11-44d90218ef7a` is serialized (`180B`) with `TTL = 5`, `hop_count = 0`, `sos_flag = 0x11` (`PROTO_VER=1 | IS_SOS=1`), committed to `outbox_packets`, and reflected in Node A's `4-byte` rolling CRC32 outbox digest inside BLE Service Data so scanning peers detect state delta before opening a costly GATT connection.
2. **Ingress Validation & Atomic Decrement (`Node B`)**: `MeshRouter.processIncomingPacket()` verifies the 64-byte Ed25519 signature against immutable bytes, checks `seen_packets` (`O(1)` indexed lookup), confirms `ttl > 0`, and executes `decrementTTL()` (`TTL: 5 -> 4`, `hop_count: 0 -> 1`). Inside a single `@Transaction`, Room inserts into `seen_packets` and `outbox_packets` (provided resulting `TTL > 0`).
3. **Blackout Survival (`T+15s` to `T+190s`)**: Even if Android's Low-Memory Killer reclaims the UI process while the courier climbs out of a basement, `LeylineDatabase` in `JournalMode.WRITE_AHEAD_LOGGING` preserves the `TTL=4` frame on flash storage; `MeshRelayForegroundService` (`foregroundServiceType="connectedDevice"`) resumes BLE advertising immediately.
4. **Terminal / Multi-Hop Relay (`Node C`)**: `Node C` receives the `180B` frame (`TTL=4, hop_count=1`), validates `Node A`'s original signature without needing `Node A` in radio range, surfaces the GPS coordinates to the local responder UI, and decrements to `TTL=3, hop_count=2` for any further downstream hops. Once `TTL` reaches `1` on a hop, the receiving node processes and displays the SOS locally (`1 - 1 = 0`) and **does not** enqueue it into `outbox_packets`, deterministically terminating propagation.

---

## 3. Edge-Case Failure Modes & Deterministic Recoveries

### Failure Mode 1: GATT Connection Drop Mid-Chunk Transfer (`status=133` / `GATT_CONN_TIMEOUT`)
* **Trigger Condition:** Two moving pedestrians initiate a multi-chunk SOS transfer (e.g., 4 chunks = `720 bytes` carrying medical triage notes) over noisy 2.4 GHz spectrum, and the link drops after Chunk `1/4` (`chunk_meta = 0x13`) due to RF shadowing or Android's infamous `GATT_ERROR (133)`.
* **Unmitigated Failure:** Naive BLE implementations discard partial buffers in RAM, leak one of Android's 32 global GATT client handles when `gatt.close()` is missed, and force complete re-transmission from Chunk `0` on reconnect—starving airtime and draining battery.
* **Leyline Recovery Mechanism:**
  1. Incoming multi-chunk frames are written immediately to a persistent Room `chunk_staging` table keyed by `(message_id, chunk_index)` with a 16-bit `received_bitmask`.
  2. On `onConnectionStateChange(status != GATT_SUCCESS, STATE_DISCONNECTED)`, `GattClientPool` explicitly invokes `gatt.close()`, applies exponential backoff (`250ms * 2^attempt` + jitter), and reconnects.
  3. During GATT handshake, the receiver exposes an `18-byte` `CharacteristicResumeVector` (`16B message_id` + `2B bitmask`, e.g., `0b0000_0000_0000_0011`). The sender reads the bitmask and transmits **only** missing chunks (`Chunk 2` and `Chunk 3`), reassembling the full payload atomically once `bitmask == (1 << total_chunks) - 1`.

### Failure Mode 2: SQLite Outbox Overflow Under Prolonged Partition
* **Trigger Condition:** A relay handset in a crowded shelter ingests thousands of ambient chat/telemetry frames over 12 hours without encountering an egress responder, exhausting the bounded `outbox_packets` storage quota (`MAX_OUTBOX_FRAMES = 4,096` / `~737 KB` wire data).
* **Unmitigated Failure:** Unbounded SQLite growth triggers `SQLiteFullException` or `CursorWindow` `2 MB` IPC crashes on Android, or naive FIFO eviction purges life-critical `SOS` beacons in favor of newer low-priority chatter.
* **Leyline Recovery Mechanism:**
  1. `OutboxDao` enforces a strict 4,096-row ceiling inside the `@Transaction` write path using a **Priority-Stratified Eviction Policy**:
     ```sql
     DELETE FROM outbox_packets
     WHERE message_id IN (
       SELECT message_id FROM outbox_packets
       WHERE is_sos = 0
       ORDER BY ttl ASC, hop_count DESC, created_at_ms ASC
       LIMIT :overflowCount
     );
     ```
  2. Frames with `IS_SOS == 1` (`sos_flag & 0x01 != 0`) are **pinned in a protected partition** (up to 90% of total capacity). Non-SOS frames closest to expiration (`lowest TTL`, `highest hop_count`, `oldest timestamp`) are evicted first.
  3. Only if all 4,096 slots are occupied exclusively by active `IS_SOS` frames does the engine evict the oldest `IS_SOS` frame that has already achieved `peer_ack_count >= 3` (verified replicated across at least 3 distinct neighbors).

### Failure Mode 3: Infinite Broadcast Storm & Cyclic Routing Loop (`A -> B -> C -> A`)
* **Trigger Condition:** Dense cluster of 15+ devices in an underground metro station forms cyclic topologies where `Node C` advertises a frame back within range of `Node A` and `Node B`, while simultaneous BLE discovery triggers synchronized channel `37/38/39` packet collisions.
* **Unmitigated Failure:** Exponential packet amplification saturates the BLE controller (`BluetoothGatt.writeCharacteristic` returns `false` / `ERROR_GATT_WRITE_REQUEST_BUSY`), paralyzing the radio stack within seconds.
* **Leyline Recovery Mechanism:**
  1. **Cryptographic & UUIDv7 Deduplication (`seen_packets`):** Every originated and ingested `message_id` is recorded in an indexed `seen_packets` SQLite table backed by an in-memory `4,096-entry` thread-safe LRU cache. Any frame whose `message_id` already exists in `seen_packets` is dropped in `< 0.05 ms` (`RoutingDecision.DroppedDuplicate`) before touching SQLite write locks or downstream queues.
  2. **Header Invariant Guard:** `MeshRouter` enforces `packet.ttl > 0`, `packet.hopCount < MAX_NETWORK_DIAMETER`, and `packet.ttl + packet.hopCount <= MAX_NETWORK_DIAMETER (16)`. Even if a peer clears storage, `TTL` strictly decreases on every hop, guaranteeing mathematical termination in at most `15` hops.
  3. **Trickle-Inspired Suppression & Jitter:** Before advertising an updated outbox digest, `TrickleScheduler` applies a randomized transmission window (`[60ms, 340ms]` CSPRNG jitter). If a node overhears `k >= 3` neighbors already advertising the identical outbox digest within the current interval, it doubles its advertising interval (`100ms -> 200ms -> 400ms -> max 2,000ms`), suppressing redundant airtime while keeping SOS latency sub-second on topology changes.

---

## 4. Multi-Device Physical Test Log (3-Node Airplane Mode Verification)

Captured via wired USB debugging (`adb -s <serial> logcat -v time LeylineBLE:I MeshRouter:I OutboxDAO:I *:S`) across three physical Android devices with SIM cards removed, Wi-Fi disabled, and Global Airplane Mode enabled (`adb shell settings get global airplane_mode_on` -> `1`), with Bluetooth explicitly re-enabled offline:

* **Node A (Origin):** Google Pixel 7a (Android 15, `SenderID = 8F21A409C311E04A`) — Basement stairwell
* **Node B (Relay Mule):** Nothing Phone (2) (Android 14, `NodeID = 31B7D0884E1029CC`) — Mobile courier
* **Node C (Responder):** Samsung Galaxy S23 (Android 14, `NodeID = 99E402A17F66B301`) — Courtyard command table (`42m` NLOS from Node A)

```log
10-26 03:14:02.114 I/LeylineBLE( 8412): [NODE-A 8F21A409] AirplaneMode=1 | NetInterfaces=[] | BLE=STATE_ON | Phy=LE_1M
10-26 03:14:02.189 I/MeshRouter( 8412): [NODE-A] Originating SOS msgId=019384e0-7b12-7c90-8a11-44d90218ef7a len=180B ttl=5 hop=0 sosFlag=0x11 lat=28.5450120 lon=77.1926440
10-26 03:14:02.196 I/OutboxDAO ( 8412): [NODE-A] WAL COMMIT outbox_packets rows=1/4096 digest=0x9C4E1208 (tx=4.2ms)
10-26 03:14:02.210 I/LeylineBLE( 8412): [NODE-A] Advertising started uuid=0000fd77-0000-1000-8000-00805f9b34fb advTx=ADVERTISE_TX_POWER_HIGH

10-26 03:14:08.642 I/LeylineBLE(11904): [NODE-B 31B7D088] ScanMatch peer=54:9A:11:C0:4E:02 rssi=-67dBm peerDigest=0x9C4E1208 != localDigest=0x00000000
10-26 03:14:08.815 I/LeylineBLE(11904): [NODE-B] GATT Connected peer=54:9A:11:C0:4E:02 | Negotiating requestMtu(185)...
10-26 03:14:08.891 I/LeylineBLE(11904): [NODE-B] onMtuChanged mtu=185 status=GATT_SUCCESS (usableAttPayload=182B)
10-26 03:14:08.934 I/LeylineBLE( 8412): [NODE-A] Sent 180B WRITE_NO_RESPONSE msgId=019384e0-7b12-7c90-8a11-44d90218ef7a to peer=31B7D088
10-26 03:14:08.948 I/MeshRouter(11904): [NODE-B] Rx 180B msgId=019384e0..ef7a | Ed25519Verify(sender=8F21A409)=VALID (1.1ms)
10-26 03:14:08.951 I/MeshRouter(11904): [NODE-B] SeenCache=MISS | decrementTTL: ttl 5->4, hopCount 0->1 | Decision=STORE_AND_FORWARD
10-26 03:14:08.959 I/OutboxDAO (11904): [NODE-B] WAL COMMIT seen_packets+outbox_packets msgId=019384e0..ef7a ttl=4 hop=1 digest=0x41B08E77
10-26 03:14:19.402 W/LeylineBLE(11904): [NODE-B] Peer 54:9A:11:C0:4E:02 out of range (status=8 GATT_CONN_TIMEOUT). gatt.close() released cleanly.
10-26 03:14:45.000 I/LeylineBLE(11904): [NODE-B] Radio blackout window: 0 peers in scan window (26.1s elapsed). Outbox holding 1 SOS frame on disk.

10-26 03:15:12.308 I/LeylineBLE(14220): [NODE-C 99E402A1] AirplaneMode=1 | ScanMatch peer=6B:1F:88:23:09:D4 (NODE-B) rssi=-61dBm peerDigest=0x41B08E77
10-26 03:15:12.487 I/LeylineBLE(14220): [NODE-C] GATT Connected + onMtuChanged mtu=185 status=GATT_SUCCESS
10-26 03:15:12.539 I/MeshRouter(14220): [NODE-C] Rx 180B msgId=019384e0..ef7a from relay=31B7D088 | OriginSender=8F21A409 | Ed25519Verify=VALID
10-26 03:15:12.543 I/MeshRouter(14220): [NODE-C] SOS DELIVERED [28.5450120, 77.1926440] "Structural collapse Stairwell B, 2 injured" | hopCount=1->2, ttl=4->3
10-26 03:15:12.551 I/OutboxDAO (14220): [NODE-C] WAL COMMIT seen_packets+outbox_packets (ttl=3, hop=2) + AckReceipt(0xAC, msgId=019384e0..ef7a) sent to NODE-B
10-26 03:15:18.904 I/MeshRouter(11904): [NODE-B] LoopCheck: overheard NODE-C digest containing msgId=019384e0..ef7a -> SeenCache=HIT -> DropDuplicate (0 bytes sent)
```

---

## 5. Modular Repository Architecture

```text
leyline-relay/
├── settings.gradle.kts                  # Multi-module declaration (:app, :ble-core, :routing-engine, :database, :wire-protocol)
├── build.gradle.kts                     # Kotlin 2.0.21, AGP 8.7, KSP, strict offline dependency verification
├── gradle/
│   └── libs.versions.toml               # Pinned offline-safe Jetpack & Coroutines catalog (ZERO cloud/analytics SDKs)
├── app/                                 # Foreground Service Orchestrator & OLED Tactical SOS UI
│   └── src/main/
│       ├── AndroidManifest.xml          # BLUETOOTH_SCAN/ADVERTISE/CONNECT + FOREGROUND_SERVICE_CONNECTED_DEVICE (NO INTERNET perm)
│       └── kotlin/net/leylinerelay/app/
│           ├── service/MeshRelayForegroundService.kt
│           └── ui/SosDispatchScreen.kt
├── wire-protocol/                       # Pure Kotlin 180B ByteBuffer Codec & Ed25519 Signer (Zero Android deps)
│   └── src/main/kotlin/net/leylinerelay/wire/
│       ├── BinaryPacketCodec.kt
│       └── Ed25519PacketSigner.kt
├── routing-engine/                      # Pure Kotlin Delay-Tolerant Routing State Machine
│   └── src/main/kotlin/net/leylinerelay/routing/
│       ├── MeshRouter.kt                # Core processIncomingPacket() & decrementTTL() contracts
│       ├── TrickleScheduler.kt
│       └── ChunkReassembler.kt
├── database/                            # Jetpack Room SQLite WAL Store-and-Forward Persistence
│   └── src/main/kotlin/net/leylinerelay/database/
│       ├── LeylineDatabase.kt
│       └── dao/OutboxDao.kt             # Atomic seen+enqueue @Transaction & 4,096-cap SOS-protected eviction SQL
└── ble-core/                            # Hardware BLE Central/Peripheral & L2CAP/GATT Transport Layer
    └── src/main/kotlin/net/leylinerelay/ble/
        ├── BleAdvertiser.kt
        ├── BleScanner.kt
        └── gatt/GattClientPool.kt
```

---

## 6. Tool & Dependency Disclosure (Zero-Cloud Architecture)

Leyline Relay is engineered with **ZERO external cloud dependencies**, **ZERO third-party proprietary mesh SDKs** (no Bridgefy, no Nearby Connections closed blobs, no Firebase, no Google Play Services runtime requirement), and **explicitly omits `android.permission.INTERNET` from `AndroidManifest.xml`** so offline integrity is verifiable via static APK inspection (`aapt dump permissions app-release.apk`).

| Subsystem | Native API / Open-Source Library | Role in Leyline Relay |
| :--- | :--- | :--- |
| **BLE Discovery** | `android.bluetooth.le.BluetoothLeScanner`, `ScanFilter`, `ScanSettings` | Hardware-offloaded UUID `0xFD77` scan filtering with `CALLBACK_TYPE_ALL_MATCHES` and duty-cycled intervals. |
| **BLE Beacon** | `android.bluetooth.le.BluetoothLeAdvertiser`, `AdvertiseData` | Broadcasts compact 24-byte Legacy Advertising PDU carrying rolling 4-byte outbox digest. |
| **BLE Transport** | `android.bluetooth.BluetoothGatt`, `BluetoothGattServer` | Asynchronous L2CAP-backed GATT client/server pool with `requestMtu(185)` and `WRITE_TYPE_NO_RESPONSE`. |
| **Background Execution** | `android.app.Service` (`FOREGROUND_SERVICE_CONNECTED_DEVICE`) | Keeps BLE router alive across screen-off states in Airplane Mode without Play Services wakelocks. |
| **DTN Persistence** | `androidx.room:room-ktx:2.6.1` (SQLite `WAL` mode) | Atomic Store-and-Forward `outbox_packets`, `seen_packets`, and `chunk_staging` tables with crash recovery. |
| **Concurrency** | `org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0` | Structured concurrency, `callbackFlow` BLE wrappers, `Mutex`-serialized GATT command queue. |
| **Wire Serialization** | `java.nio.ByteBuffer` (`ByteOrder.BIG_ENDIAN`) | Zero-reflection, zero-allocation 180-byte binary frame encoder/decoder. |
| **Packet Authenticity** | `java.security.KeyPairGenerator` (`Ed25519` / Conscrypt Android API 33+ & BouncyCastle `bcprov-jdk18on` fallback for API 26–32) | Offline end-to-end 64-byte detached packet signing and relay verification without CA certificates. |
| **UI Layer** | `androidx.compose.material3` (Jetpack Compose) | High-contrast OLED tactical SOS dispatch console and live peer topology monitor. |

---

## License

Released under the **Apache License 2.0** for **Droidrush 2026 — Problem Statement 07 ("The Blackout Leyline")**.
