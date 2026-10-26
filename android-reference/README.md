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

---

## 3. Edge-Case Failure Modes & Deterministic Recoveries

1. **GATT Connection Drop Mid-Chunk Transfer (`status=133` / `GATT_CONN_TIMEOUT`)**: Multi-chunk transfers persist each fragment immediately to Room `chunk_staging` with a 16-bit `received_bitmask`, release `gatt.close()` cleanly to avoid Android's 32-client GATT leak, and exchange an `18-byte` `CharacteristicResumeVector` on reconnect to transmit only missing chunk indices.
2. **SQLite Outbox Overflow Under Prolonged Partition**: `OutboxDao` enforces a strict `4,096-frame` quota inside `@Transaction` using Priority-Stratified Eviction (`IS_SOS == 1` frames pinned; `is_sos = 0` ordered by `ttl ASC, hop_count DESC, created_at_ms ASC` purged first).
3. **Infinite Broadcast Storm & Cyclic Routing Loop (`A -> B -> C -> A`)**: Dual-tier `O(1)` deduplication (`4,096-entry` RAM LRU + indexed `seen_packets` SQLite table), strict monotonic `TTL` decrement + `ttl + hop_count <= 16` guard, `4-byte` rolling CRC32 Service Data digest to skip redundant GATT connections, and `[60ms, 340ms]` Trickle jitter.

---

## 4. Multi-Device Physical Test Log (3-Node Airplane Mode Verification)

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

## 5. Tool & Dependency Disclosure (Zero-Cloud Architecture)

* **Native Android BLE**: `BluetoothLeScanner`, `BluetoothLeAdvertiser`, `BluetoothGatt`, `BluetoothGattServer`, `Service` (`FOREGROUND_SERVICE_CONNECTED_DEVICE`).
* **Local Persistence & Serialization**: `androidx.room:room-ktx:2.6.1` (`WRITE_AHEAD_LOGGING`), `kotlinx-coroutines-android:1.9.0`, `java.nio.ByteBuffer` (`BIG_ENDIAN`), `java.security` `Ed25519`.
* **Zero External Cloud Guarantee**: Zero Firebase/Play Services SDKs and **explicit omission of `android.permission.INTERNET` in `AndroidManifest.xml`**.
