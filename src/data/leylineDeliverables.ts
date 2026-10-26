export interface PacketFieldSpec {
  id: string;
  offsetHex: string;
  startByte: number;
  endByte: number;
  sizeBytes: number;
  name: string;
  wireType: string;
  signedInEd25519: boolean;
  summary: string;
  invariant: string;
}

export interface FailureModeSpec {
  id: string;
  number: string;
  title: string;
  trigger: string;
  unmitigatedImpact: string;
  recoverySteps: string[];
  verificationMetric: string;
}

export interface ToolDisclosureItem {
  subsystem: string;
  artifact: string;
  purpose: string;
}

export interface KotlinFileArtifact {
  id: 'mesh-router' | 'ble-advertiser' | 'ble-scanner';
  filename: string;
  moduleName: string;
  packagePath: string;
  summary: string;
  code: string;
}

export const PACKET_FIELDS: PacketFieldSpec[] = [
  {
    id: 'message_id',
    offsetHex: '0–15 (0x00..0x0F)',
    startByte: 0,
    endByte: 15,
    sizeBytes: 16,
    name: 'Message ID',
    wireType: 'UUID (16B)',
    signedInEd25519: true,
    summary: 'Unique ID for every message so phones never process or forward the same alert twice.',
    invariant: 'Saved in seen_packets so duplicate relays are ignored right away.'
  },
  {
    id: 'sender_id',
    offsetHex: '16–23 (0x10..0x17)',
    startByte: 16,
    endByte: 23,
    sizeBytes: 8,
    name: 'Sender ID',
    wireType: 'UInt64 (8B)',
    signedInEd25519: true,
    summary: 'Short public-key fingerprint identifying which phone sent the SOS without leaking MAC addresses.',
    invariant: 'Stays constant even when Android rotates Bluetooth addresses.'
  },
  {
    id: 'ttl',
    offsetHex: '24 (0x18)',
    startByte: 24,
    endByte: 24,
    sizeBytes: 1,
    name: 'TTL',
    wireType: 'UInt8 (1B)',
    signedInEd25519: false,
    summary: 'Hops remaining (starts at 5 or 7). Every relay phone subtracts 1. Stops when it reaches 0.',
    invariant: 'Left outside the digital signature so middle phones can count it down.'
  },
  {
    id: 'hop_count',
    offsetHex: '25 (0x19)',
    startByte: 25,
    endByte: 25,
    sizeBytes: 1,
    name: 'Hop Count',
    wireType: 'UInt8 (1B)',
    signedInEd25519: false,
    summary: 'How many phones the packet has jumped through so far (starts at 0 and adds 1 per hop).',
    invariant: 'Left outside the signature; checked so TTL + Hop Count never exceeds 16.'
  },
  {
    id: 'sos_flag',
    offsetHex: '26 (0x1A)',
    startByte: 26,
    endByte: 26,
    sizeBytes: 1,
    name: 'SOS Flag',
    wireType: 'Bitfield (1B)',
    signedInEd25519: true,
    summary: 'Marks whether this is a life-critical SOS alert (1) or a normal status message (0).',
    invariant: 'Locked by signature so SOS priority cannot be downgraded.'
  },
  {
    id: 'chunk_meta',
    offsetHex: '27 (0x1B)',
    startByte: 27,
    endByte: 27,
    sizeBytes: 1,
    name: 'Chunk Info',
    wireType: 'UInt8 (1B)',
    signedInEd25519: true,
    summary: 'Tracks piece numbers (e.g., Chunk 1 of 1 for standard SOS, or Chunk 2 of 4 for longer notes).',
    invariant: 'Lets phones resume missing pieces without starting over.'
  },
  {
    id: 'payload',
    offsetHex: '28–115 (0x1C..0x73)',
    startByte: 28,
    endByte: 115,
    sizeBytes: 88,
    name: 'Payload',
    wireType: 'Bytes[88]',
    signedInEd25519: true,
    summary: 'Emergency content: GPS Latitude (4B), GPS Longitude (4B), Battery % (2B), and 78 characters of text.',
    invariant: 'Zero-padded to 88 bytes so the packet is always 180 bytes.'
  },
  {
    id: 'signature',
    offsetHex: '116–179 (0x74..0xB3)',
    startByte: 116,
    endByte: 179,
    sizeBytes: 64,
    name: 'Signature',
    wireType: 'Ed25519 (64B)',
    signedInEd25519: true,
    summary: 'Digital signature proving the SOS alert was not faked or edited along the way.',
    invariant: 'Verified completely offline at every phone before saving.'
  }
];

export const FAILURE_MODES: FailureModeSpec[] = [
  {
    id: 'gatt-133-drop',
    number: '01',
    title: 'Bluetooth Drops Mid-Message (GATT Error 133)',
    trigger:
      'Two people walk past each other while sending a 4-chunk medical note (720 bytes), and Bluetooth disconnects halfway through with Android GATT status=133.',
    unmitigatedImpact:
      'Basic apps throw away received chunks in RAM, leak Bluetooth sockets if gatt.close() is missed, and restart from Chunk 1 every time.',
    recoverySteps: [
      'Save each incoming chunk right away in a SQLite chunk_staging table along with a checklist (bitmask) of received pieces.',
      'Call gatt.close() cleanly on disconnect to free the Bluetooth handle, wait briefly, and reconnect.',
      'Share the checklist on reconnect so the sender only transmits the missing chunks (Chunks 3 and 4).'
    ],
    verificationMetric: 'Resumes from exact missing chunk; 0 leaked Bluetooth connections.'
  },
  {
    id: 'sqlite-outbox-overflow',
    number: '02',
    title: 'SQLite Outbox Fills Up During a Long Blackout',
    trigger:
      'A phone in a crowded shelter collects thousands of messages over 12+ hours with no rescue team nearby, hitting the 4,096-packet storage limit.',
    unmitigatedImpact:
      'Unlimited growth crashes the database, while simple "delete oldest" logic could erase life-saving SOS alerts.',
    recoverySteps: [
      'Cap the outbox table strictly at 4,096 packets (~737 KB total on disk).',
      'Protect all SOS alerts (SOS Flag = 1) so normal messages can never push them out.',
      'Delete non-SOS messages first, starting with the lowest TTL and highest Hop Count (closest to expiring anyway).'
    ],
    verificationMetric: '100% of SOS alerts kept safe even during a 10,000-message flood.'
  },
  {
    id: 'broadcast-loop-storm',
    number: '03',
    title: 'Infinite Message Loops (Phone A -> B -> C -> A)',
    trigger:
      'Phones standing in a circle broadcast the same alert back to Phone A and Phone B, risking an endless Bluetooth echo storm.',
    unmitigatedImpact:
      'Repeated rebroadcasts jam Bluetooth channels and drain every phone battery in minutes.',
    recoverySteps: [
      'Record every Message ID in a fast seen_packets list and immediately ignore any packet already seen.',
      'Include a tiny 4-byte outbox summary in Bluetooth beacons so phones with identical messages skip connecting.',
      'Count TTL down by 1 on every hop (stopping at 0) and wait a random 60–340ms delay before broadcasting.'
    ],
    verificationMetric: 'Duplicate packets dropped in <1 ms; zero endless echo loops.'
  }
];

export const TOOL_DISCLOSURE: ToolDisclosureItem[] = [
  {
    subsystem: 'Bluetooth Scanning',
    artifact: 'BluetoothLeScanner (Android SDK)',
    purpose: 'Finds nearby Leyline phones using hardware filters to save battery.'
  },
  {
    subsystem: 'Bluetooth Beacons',
    artifact: 'BluetoothLeAdvertiser (Android SDK)',
    purpose: 'Broadcasts a small 24-byte signal showing if this phone carries new SOS alerts.'
  },
  {
    subsystem: 'Packet Transfer',
    artifact: 'BluetoothGatt & BluetoothGattServer',
    purpose: 'Requests a 185-byte transfer slot and sends the 180-byte packet phone-to-phone.'
  },
  {
    subsystem: 'Background Relay',
    artifact: 'Android ForegroundService (connectedDevice)',
    purpose: 'Keeps Bluetooth relaying active while phones are locked inside pockets.'
  },
  {
    subsystem: 'Offline Outbox DB',
    artifact: 'Jetpack Room (androidx.room SQLite WAL)',
    purpose: 'Stores messages safely on disk during dead zones and app restarts.'
  },
  {
    subsystem: 'Async Tasks',
    artifact: 'Kotlin Coroutines & Flow',
    purpose: 'Handles Bluetooth connections smoothly in the background without UI lag.'
  },
  {
    subsystem: 'Binary Packing',
    artifact: 'java.nio.ByteBuffer (BIG_ENDIAN)',
    purpose: 'Packs and unpacks fields cleanly into exact byte positions (0–179).'
  },
  {
    subsystem: 'Digital Signatures',
    artifact: 'java.security (Ed25519)',
    purpose: 'Signs and verifies SOS alerts completely offline without internet certificates.'
  }
];

export const TEST_LOG_RAW = `10-26 03:14:02.114 I/LeylineBLE( 8412): [NODE-A] AirplaneMode=ON | Internet=NONE | Bluetooth=ON
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
10-26 03:15:18.904 I/MeshRouter(11904): [NODE-B] Heard echo from NODE-C -> Already in seen_packets -> Ignored duplicate (loop stopped)`;

export const REPO_TREE_ASCII = `leyline-relay/
├── settings.gradle.kts                  # Multi-module declaration (:app, :ble-core, :routing-engine, :database, :wire-protocol)
├── build.gradle.kts                     # Kotlin 2.0.21, AGP 8.7, KSP, strict offline dependency verification
├── gradle/
│   └── libs.versions.toml               # Pinned offline-safe Jetpack & Coroutines catalog (ZERO cloud/analytics SDKs)
│
├── app/                                 # Android Application Shell & Foreground Service Orchestrator
│   ├── src/main/
│   │   ├── AndroidManifest.xml          # BLUETOOTH_SCAN/ADVERTISE/CONNECT + FOREGROUND_SERVICE_CONNECTED_DEVICE (NO INTERNET perm)
│   │   └── kotlin/net/leylinerelay/app/
│   │       ├── LeylineApplication.kt
│   │       ├── service/
│   │       │   └── MeshRelayForegroundService.kt   # Binds BleScanner + BleAdvertiser + GattServer to SQLite Outbox
│   │       └── ui/
│   │           ├── SosDispatchScreen.kt            # High-contrast OLED SOS composer & triage selector
│   │           └── MeshTopologyMonitorScreen.kt    # Real-time hop counter, RSSI graph & outbox queue inspector
│
├── wire-protocol/                       # Pure Kotlin Binary Frame Serializer & Ed25519 Signer (Zero Android deps)
│   └── src/
│       ├── main/kotlin/net/leylinerelay/wire/
│       │   ├── BinaryPacketCodec.kt     # Deterministic 180-byte ByteBuffer (BIG_ENDIAN) encoder/decoder
│       │   ├── Ed25519PacketSigner.kt   # Detached 64B signing over immutable bytes (excludes TTL & hopCount)
│       │   └── UuidV7Generator.kt       # Monotonic 128-bit timestamp + CSPRNG packet IDs
│       └── test/kotlin/net/leylinerelay/wire/
│           └── BinaryPacketCodecTest.kt # Bit-exact 180B boundary, fuzzing & signature tamper unit tests
│
├── routing-engine/                      # Pure Kotlin Delay-Tolerant Routing State Machine
│   └── src/
│       ├── main/kotlin/net/leylinerelay/routing/
│       │   ├── MeshRouter.kt            # Core processIncomingPacket() & decrementTTL() contracts
│       │   ├── TrickleScheduler.kt      # [60ms..340ms] jitter & k>=3 redundant beacon suppression
│       │   └── ChunkReassembler.kt      # 16-chunk bitmask staging & resume vector calculator
│       └── test/kotlin/net/leylinerelay/routing/
│           └── MultiHopLoopSimulationTest.kt       # Deterministic 20-node cyclic graph & TTL exhaustion tests
│
├── database/                            # Jetpack Room SQLite WAL Store-and-Forward Persistence
│   └── src/main/kotlin/net/leylinerelay/database/
│       ├── LeylineDatabase.kt           # JournalMode.WRITE_AHEAD_LOGGING configuration
│       ├── entity/
│       │   ├── OutboxPacketEntity.kt    # Indexed on (is_sos DESC, ttl ASC, hop_count DESC, created_at_ms ASC)
│       │   ├── SeenPacketEntity.kt      # Dedup ledger with rolling 48-hour compaction
│       │   └── ChunkStagingEntity.kt    # Partial multi-chunk persistence across GATT status=133 drops
│       └── dao/
│           ├── OutboxDao.kt             # Atomic seen+enqueue @Transaction & 4,096-cap SOS-protected eviction SQL
│           └── ChunkStagingDao.kt       # Bitmask query for CharacteristicResumeVector
│
└── ble-core/                            # Hardware BLE Central/Peripheral & L2CAP/GATT Transport Layer
    └── src/main/kotlin/net/leylinerelay/ble/
        ├── BleAdvertiser.kt             # 24B Legacy PDU Service Data (UUID 0xFD77 + 4B CRC32 outbox digest)
        ├── BleScanner.kt                # Hardware ScanFilter + Android 5-scans/30s throttle guard
        ├── AndroidBleAdvertiser.kt      # Concrete BluetoothLeAdvertiser implementation
        ├── AndroidBleScanner.kt         # Concrete callbackFlow BluetoothLeScanner implementation
        └── gatt/
            ├── GattServerManager.kt     # Inbound 180B WRITE_TYPE_NO_RESPONSE receiver + 18B ResumeVector characteristic
            ├── GattClientPool.kt        # Mutex-serialized connectGatt(), requestMtu(185), status=133 backoff & gatt.close()
            └── BleMutexQueue.kt         # Enforces Android's strict single-in-flight GATT operation invariant`;

export const KOTLIN_FILES: KotlinFileArtifact[] = [
  {
    id: 'mesh-router',
    filename: 'MeshRouter.kt',
    moduleName: ':routing-engine',
    packagePath: 'routing-engine/src/main/kotlin/net/leylinerelay/routing/MeshRouter.kt',
    summary: 'Core DTN routing interface and deterministic reference logic for processIncomingPacket() and decrementTTL().',
    code: `package net.leylinerelay.routing

import kotlinx.coroutines.flow.Flow
import java.util.UUID

/**
 * Core delay-tolerant routing contract for Problem Statement 07 ("The Blackout Leyline").
 * Pure Kotlin module (:routing-engine) — zero Android Context dependencies for deterministic JVM testing.
 */
interface MeshRouter {

    /** Stream of verified life-safety or tactical frames addressed to or surfaced at this node. */
    val inboundDeliveries: Flow<RoutedDelivery>

    /**
     * Evaluates a raw 180-byte wire frame received from GATT Server/Client transport,
     * enforces cryptographic authenticity, loop suppression, and atomic TTL mutation,
     * and commits forwardable frames to the WAL-backed SQLite Store-and-Forward outbox.
     */
    suspend fun processIncomingPacket(
        rawFrame: ByteArray,
        ingressPeerAddress: String,
        rssiDbm: Int
    ): RoutingDecision

    /**
     * Pure deterministic header transformation across a single hop.
     * Decrements [LeylinePacket.ttl] by 1 and increments [LeylinePacket.hopCount] by 1
     * without mutating the canonical bytes covered by the origin Ed25519 signature.
     */
    fun decrementTTL(packet: LeylinePacket): TtlMutationResult
}

data class LeylinePacket(
    val messageId: UUID,             // Offset 0x00..0x0F (16B UUIDv7)
    val senderId: Long,              // Offset 0x10..0x17 (8B SHA-256 pubkey prefix)
    val ttl: UByte,                  // Offset 0x18       (1B remaining hops: 0..15)
    val hopCount: UByte,             // Offset 0x19       (1B traversed hops: 0..15)
    val sosFlags: UByte,             // Offset 0x1A       (1B bitfield: bit0 = IS_SOS)
    val chunkMeta: UByte,            // Offset 0x1B       (1B (chunkIdx << 4) | (totalChunks - 1))
    val payload: ByteArray,          // Offset 0x1C..0x73 (88B binary coordinates + UTF-8 emergency body)
    val signature: ByteArray         // Offset 0x74..0xB3 (64B Ed25519 detached signature)
) {
    val isSos: Boolean get() = (sosFlags.toInt() and 0x01) != 0

    companion object {
        const val WIRE_SIZE_BYTES: Int = 180
        const val MAX_NETWORK_DIAMETER: Int = 16
    }
}

sealed interface TtlMutationResult {
    data class Forwardable(val mutatedPacket: LeylinePacket) : TtlMutationResult
    data class ExhaustedAtLocalNode(val terminalPacket: LeylinePacket) : TtlMutationResult
    data class InvalidHeaderInvariant(val reason: String) : TtlMutationResult
}

sealed interface RoutingDecision {
    data class StoredAndForwarded(val messageId: UUID, val remainingTtl: UByte, val hopCount: UByte) : RoutingDecision
    data class DeliveredTerminalOnly(val messageId: UUID, val hopCount: UByte) : RoutingDecision
    data class StagedPartialChunk(val messageId: UUID, val receivedBitmask: Int, val totalChunks: Int) : RoutingDecision
    data class DroppedDuplicate(val messageId: UUID) : RoutingDecision
    data class DroppedInvalid(val reason: DropReason) : RoutingDecision
}

enum class DropReason {
    MALFORMED_FRAME_LENGTH,
    ZERO_INGRESS_TTL,
    DIAMETER_INVARIANT_VIOLATION,
    INVALID_ED25519_SIGNATURE,
    OUTBOX_QUOTA_REJECTED
}

data class RoutedDelivery(
    val packet: LeylinePacket,
    val ingressPeerAddress: String,
    val rssiDbm: Int,
    val receivedAtEpochMs: Long
)

interface PacketWireCodec {
    fun decode(rawFrame: ByteArray): LeylinePacket?
    fun encode(packet: LeylinePacket): ByteArray
    fun canonicalSigningBytes(packet: LeylinePacket): ByteArray
}

interface PacketSignatureVerifier {
    fun verifyOriginSignature(senderId: Long, canonicalBytes: ByteArray, signature: ByteArray): Boolean
}

interface OutboxStore {
    suspend fun hasSeen(messageId: UUID): Boolean
    suspend fun markSeenOnly(messageId: UUID, seenAtEpochMs: Long)
    suspend fun commitSeenAndEnqueueOutbox(
        packet: LeylinePacket,
        rawWireBytes: ByteArray,
        prioritySos: Boolean,
        enqueuedAtEpochMs: Long
    ): Boolean
}

/**
 * Production reference router implementation enforcing signature check -> O(1) loop guard ->
 * deterministic TTL decrement -> atomic SQLite WAL Store-and-Forward commit.
 */
class DefaultMeshRouter(
    private val codec: PacketWireCodec,
    private val verifier: PacketSignatureVerifier,
    private val outboxStore: OutboxStore,
    private val clockEpochMs: () -> Long = System::currentTimeMillis,
    private val onLocalDelivery: suspend (RoutedDelivery) -> Unit
) : MeshRouter {

    override val inboundDeliveries: Flow<RoutedDelivery>
        get() = throw UnsupportedOperationException("Wired via SharedFlow in DI graph")

    override suspend fun processIncomingPacket(
        rawFrame: ByteArray,
        ingressPeerAddress: String,
        rssiDbm: Int
    ): RoutingDecision {
        if (rawFrame.size != LeylinePacket.WIRE_SIZE_BYTES) {
            return RoutingDecision.DroppedInvalid(DropReason.MALFORMED_FRAME_LENGTH)
        }

        val packet = codec.decode(rawFrame)
            ?: return RoutingDecision.DroppedInvalid(DropReason.MALFORMED_FRAME_LENGTH)

        // 1. Fast-path ingress TTL & header sanity guard before expensive crypto
        if (packet.ttl == 0u.toUByte()) {
            return RoutingDecision.DroppedInvalid(DropReason.ZERO_INGRESS_TTL)
        }

        // 2. O(1) LRU + indexed SQLite seen_packets loop prevention
        if (outboxStore.hasSeen(packet.messageId)) {
            return RoutingDecision.DroppedDuplicate(packet.messageId)
        }

        // 3. End-to-end Ed25519 authenticity check over immutable fields (excludes mutable TTL & hopCount)
        val sigValid = verifier.verifyOriginSignature(
            senderId = packet.senderId,
            canonicalBytes = codec.canonicalSigningBytes(packet),
            signature = packet.signature
        )
        if (!sigValid) {
            return RoutingDecision.DroppedInvalid(DropReason.INVALID_ED25519_SIGNATURE)
        }

        val now = clockEpochMs()

        // 4. Deterministic TTL decrement & hopCount increment
        return when (val mutation = decrementTTL(packet)) {
            is TtlMutationResult.InvalidHeaderInvariant ->
                RoutingDecision.DroppedInvalid(DropReason.DIAMETER_INVARIANT_VIOLATION)

            is TtlMutationResult.ExhaustedAtLocalNode -> {
                // TTL was 1 on ingress -> 0 after hop: surface locally, record seen, DO NOT re-broadcast
                outboxStore.markSeenOnly(packet.messageId, now)
                onLocalDelivery(RoutedDelivery(mutation.terminalPacket, ingressPeerAddress, rssiDbm, now))
                RoutingDecision.DeliveredTerminalOnly(
                    messageId = packet.messageId,
                    hopCount = mutation.terminalPacket.hopCount
                )
            }

            is TtlMutationResult.Forwardable -> {
                val nextPacket = mutation.mutatedPacket
                val encodedNext = codec.encode(nextPacket)
                val committed = outboxStore.commitSeenAndEnqueueOutbox(
                    packet = nextPacket,
                    rawWireBytes = encodedNext,
                    prioritySos = nextPacket.isSos,
                    enqueuedAtEpochMs = now
                )
                if (!committed) {
                    return RoutingDecision.DroppedInvalid(DropReason.OUTBOX_QUOTA_REJECTED)
                }
                onLocalDelivery(RoutedDelivery(nextPacket, ingressPeerAddress, rssiDbm, now))
                RoutingDecision.StoredAndForwarded(
                    messageId = nextPacket.messageId,
                    remainingTtl = nextPacket.ttl,
                    hopCount = nextPacket.hopCount
                )
            }
        }
    }

    override fun decrementTTL(packet: LeylinePacket): TtlMutationResult {
        val currentTtl = packet.ttl.toInt()
        val currentHops = packet.hopCount.toInt()

        if (currentTtl <= 0) {
            return TtlMutationResult.InvalidHeaderInvariant("Ingress TTL must be >= 1, got $currentTtl")
        }
        if (currentHops < 0 || currentTtl + currentHops > LeylinePacket.MAX_NETWORK_DIAMETER) {
            return TtlMutationResult.InvalidHeaderInvariant(
                "Header sum ttl($currentTtl) + hopCount($currentHops) exceeds MAX_DIAMETER"
            )
        }

        val nextTtl = (currentTtl - 1).toUByte()
        val nextHopCount = (currentHops + 1).toUByte()
        val updated = packet.copy(ttl = nextTtl, hopCount = nextHopCount)

        return if (nextTtl == 0u.toUByte()) {
            TtlMutationResult.ExhaustedAtLocalNode(updated)
        } else {
            TtlMutationResult.Forwardable(updated)
        }
    }
}`
  },
  {
    id: 'ble-advertiser',
    filename: 'BleAdvertiser.kt',
    moduleName: ':ble-core',
    packagePath: 'ble-core/src/main/kotlin/net/leylinerelay/ble/BleAdvertiser.kt',
    summary: 'Compact 24-byte Legacy Advertising PDU contract broadcasting rolling 4B CRC32 outbox digest & SOS flag.',
    code: `package net.leylinerelay.ble

import kotlinx.coroutines.flow.StateFlow
import java.util.UUID

/**
 * BLE Peripheral beacon contract (:ble-core) wrapping android.bluetooth.le.BluetoothLeAdvertiser.
 *
 * Broadcasts a compact 24-byte Legacy Advertising PDU (strictly <= 31B limit) containing:
 *  - 16-bit Service UUID 0xFD77 (Leyline Emergency Mesh)
 *  - 8-byte Service Data payload:
 *      [0..3] rolling CRC32 digest of active SQLite outbox message_ids (enables zero-connect sync skipping)
 *      [4]    highest pending priority flag (Bit 0 = ACTIVE_SOS_PENDING)
 *      [5]    available outbox queue headroom bucket (0..255)
 *      [6..7] ephemeral 16-bit node session salt (anti-MAC-rotation correlation)
 */
interface BleAdvertiser {

    /** Reactive state of the underlying BluetoothLeAdvertiser hardware slot. */
    val advertiserState: StateFlow<AdvertiserState>

    /**
     * Starts non-scannable, connectable BLE advertising using the provided [BeaconPayload].
     * Safe to invoke repeatedly; implementations coalesce rapid SQLite outbox mutations via Trickle jitter.
     */
    suspend fun startAdvertising(
        payload: BeaconPayload,
        profile: AdvertisePowerProfile = AdvertisePowerProfile.EMERGENCY_HIGH_DUTY
    ): Result<Unit>

    /**
     * Atomically rotates the 8-byte Service Data beacon when the local SQLite outbox digest changes
     * (e.g., new SOS originated or hop-decremented packet committed).
     */
    suspend fun updateOutboxDigest(payload: BeaconPayload): Result<Unit>

    /** Releases the hardware advertising slot cleanly (e.g., on BluetoothAdapter state transition). */
    suspend fun stopAdvertising()

    companion object {
        val LEYLINE_SERVICE_UUID: UUID = UUID.fromString("0000fd77-0000-1000-8000-00805f9b34fb")
        const val SERVICE_DATA_BYTES: Int = 8
    }
}

data class BeaconPayload(
    val outboxDigestCrc32: Int,      // 4B digest of sorted active outbox UUIDv7 keys
    val hasActiveSos: Boolean,       // 1B priority bit -> triggers immediate scan escalation on peers
    val queueHeadroomRatio: UByte,   // 1B backpressure indicator (0x00 = full, 0xFF = empty)
    val ephemeralNodeTag: UShort     // 2B rotating session identifier
)

enum class AdvertisePowerProfile(
    val intervalMillis: Int,
    val txPowerDbm: Int
) {
    /** Sub-second discovery when carrying unacknowledged life-safety SOS frames. */
    EMERGENCY_HIGH_DUTY(intervalMillis = 100, txPowerDbm = 1),

    /** Trickle-suppressed steady state when outbox contains only replicated/non-SOS frames. */
    BALANCED_RELAY_DUTY(intervalMillis = 400, txPowerDbm = -7),

    /** Critical battery preservation (< 15% charge) while maintaining DTN mule presence. */
    SURVIVAL_LOW_POWER(intervalMillis = 1200, txPowerDbm = -15)
}

sealed interface AdvertiserState {
    data object Idle : AdvertiserState
    data class Broadcasting(
        val activePayload: BeaconPayload,
        val profile: AdvertisePowerProfile,
        val startedAtElapsedRealtimeMs: Long
    ) : AdvertiserState
    data class Failed(val errorCode: AdvertiseFailureReason, val recoverable: Boolean) : AdvertiserState
}

enum class AdvertiseFailureReason {
    BLUETOOTH_ADAPTER_OFF,
    ADVERTISE_DATA_TOO_LARGE,        // AdvertiseCallback.ADVERTISE_FAILED_DATA_TOO_LARGE (1)
    TOO_MANY_ADVERTISERS,            // AdvertiseCallback.ADVERTISE_FAILED_TOO_MANY_ADVERTISERS (2)
    MISSING_BLUETOOTH_ADVERTISE_PERM,
    CHIPSET_UNSUPPORTED
}`
  },
  {
    id: 'ble-scanner',
    filename: 'BleScanner.kt',
    moduleName: ':ble-core',
    packagePath: 'ble-core/src/main/kotlin/net/leylinerelay/ble/BleScanner.kt',
    summary: 'Hardware-filtered Flow scanner enforcing RSSI SNR gates, digest delta matching, and 5-scans/30s protection.',
    code: `package net.leylinerelay.ble

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

/**
 * BLE Central discovery contract (:ble-core) wrapping android.bluetooth.le.BluetoothLeScanner.
 *
 * Applies hardware-offloaded ScanFilters on [BleAdvertiser.LEYLINE_SERVICE_UUID] so the host
 * AP CPU stays asleep until a genuine Leyline peer enters 2.4 GHz radio range, and respects
 * Android's strict 5-scans-per-30-seconds throttling ceiling.
 */
interface BleScanner {

    /** Observable lifecycle state of the hardware BLE scanner. */
    val scannerState: StateFlow<ScannerState>

    /**
     * Cold backpressure-aware stream of discovered Leyline peers whose advertised
     * [BeaconPayload.outboxDigestCrc32] differs from our local sync state, or who advertise
     * [BeaconPayload.hasActiveSos] == true.
     *
     * Canceling collection automatically unregisters the underlying ScanCallback.
     */
    fun observeEligiblePeers(config: ScanWindowConfig = ScanWindowConfig()): Flow<DiscoveredMeshPeer>

    /**
     * Suppresses GATT connection attempts to [deviceAddress] for [cooldownMs] following a
     * completed sync or transient GATT status=133 backoff window.
     */
    fun recordPeerSyncCooldown(deviceAddress: String, syncedDigestCrc32: Int, cooldownMs: Long)
}

data class ScanWindowConfig(
    /** Minimum RSSI threshold (-92 dBm default) preventing doomed GATT handshakes at fringe SNR. */
    val minConnectableRssiDbm: Int = -92,

    /** Duty-cycled active scan window ( <= 6,000ms cycle safety vs Android 30s scan-throttle ). */
    val activeWindowMs: Long = 8_000L,
    val idleCooldownMs: Long = 4_000L,

    /** Prioritizes peers broadcasting an unacknowledged SOS flag to jump the GATT client queue. */
    val prioritizeSosBeacons: Boolean = true
)

data class DiscoveredMeshPeer(
    val deviceAddress: String,           // Rotating BLE RPA address for BluetoothDevice.connectGatt()
    val ephemeralNodeTag: UShort,        // Stable session tag from 8-byte Service Data
    val remoteOutboxDigestCrc32: Int,    // Used to skip redundant GATT connections when digests match
    val hasActiveSos: Boolean,           // True when remote peer carries at least one SOS frame
    val remoteQueueHeadroom: UByte,      // Avoids overwhelming congested neighbor outboxes
    val rssiDbm: Int,
    val seenAtElapsedRealtimeNanos: Long
)

sealed interface ScannerState {
    data object Stopped : ScannerState
    data class Scanning(val activeWindowMs: Long, val matchedPeersInWindow: Int) : ScannerState
    data class DutyCycleIdle(val nextResumeElapsedMs: Long) : ScannerState
    data class ThrottledOrFaulted(val error: ScanFailureReason) : ScannerState
}

enum class ScanFailureReason {
    BLUETOOTH_ADAPTER_OFF,
    SCAN_FAILED_APPLICATION_REGISTRATION_FAILED, // ScanCallback error 2 (GATT/Scanner exhaustion)
    SCAN_FAILED_SCANNING_TOO_FREQUENTLY,         // Android 7+ >5 starts in 30s guard
    MISSING_BLUETOOTH_SCAN_PERM,
    INTERNAL_STACK_ERROR
}`
  }
];

export const README_MARKDOWN = `# Leyline Relay

**When cell towers fail, nearby phones become the network.**

Leyline Relay is an offline Android app built for **Droidrush 2026 (Problem Statement 07: "The Blackout Leyline")** that sends emergency SOS alerts from phone to phone using Bluetooth Low Energy (BLE) in Airplane Mode—with zero internet, Wi-Fi, or mobile signal. If no rescue team is nearby, each phone safely saves the message in its local SQLite database and automatically passes it forward as soon as another phone walks into Bluetooth range.

---

## 1. Binary Packet Specification (180-Byte Bluetooth Packet)

By default, Android Bluetooth only sends \`20 bytes\` at a time, which is too small for a signed SOS alert. As soon as two phones connect, Leyline Relay requests a \`185-byte\` Bluetooth transfer size (\`requestMtu(185)\`), which gives \`182 bytes\` of usable space.

We pack every message into a clean **180-byte binary packet** so an entire signed SOS alert travels in **one single burst**:

| Byte Range | Field Name | Size | What It Stores (Plain English) |
| :--- | :--- | :--- | :--- |
| \`0–15\` | **Message ID** | \`16 Bytes\` | A unique ID (\`UUID\`) for every message so phones never process or forward the same alert twice. |
| \`16–23\` | **Sender ID** | \`8 Bytes\` | Short fingerprint of the sender's public key so responders know which phone sent the SOS without exposing hardware MAC addresses. |
| \`24\` | **TTL (Time To Live)** | \`1 Byte\` | How many hops the packet has left (starts at \`5\` or \`7\`). Every relay phone subtracts \`1\`. If it hits \`0\`, it stops. |
| \`25\` | **Hop Count** | \`1 Byte\` | How many phones the packet has already jumped through (starts at \`0\` and goes up by \`1\` at each phone). |
| \`26\` | **SOS Flag** | \`1 Byte\` | Marks whether this is a life-critical **SOS alert** (\`1\`) or a normal status message (\`0\`), plus protocol version. |
| \`27\` | **Chunk Info** | \`1 Byte\` | Tracks piece numbers (e.g., \`Chunk 1 of 1\` for a standard SOS, or \`Chunk 2 of 4\` for longer medical notes). |
| \`28–115\` | **Payload** | \`88 Bytes\` | The actual emergency content: GPS Latitude (\`4B\`), GPS Longitude (\`4B\`), Battery % (\`2B\`), and up to \`78 characters\` of text. |
| \`116–179\` | **Signature** | \`64 Bytes\` | Digital signature (\`Ed25519\`) proving the message wasn't faked or edited along the way. |
| **Total** | **Full Packet** | **180 Bytes** | Fits safely inside a single \`185-byte\` BLE transfer (\`182 bytes\` max capacity). |

> **How Middle Phones Update TTL Without Breaking the Signature:** The digital signature locks the \`Message ID\`, \`Sender ID\`, \`SOS Flag\`, \`Chunk Info\`, and \`Payload\`, but intentionally leaves \`TTL\` and \`Hop Count\` unlocked. That way, relay phones can count down \`TTL\` at each hop while the final phone can still verify the original sender's signature.

---

## 2. How Store-and-Forward & TTL Routing Work (\`Phone A -> Phone B -> Phone C\`)

In a real disaster, the person trapped (\`Phone A\`) and the rescue team (\`Phone C\`) are often too far apart for Bluetooth to reach directly. \`Phone B\` acts as a "messenger" walking between them.

\`\`\`text
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
\`\`\`

### Step-by-Step Flow
1. **Phone A Creates the SOS (\`TTL = 5, Hop = 0\`)**: Phone A signs the 180-byte packet, saves it in its SQLite \`outbox_packets\` table, and broadcasts a tiny Bluetooth beacon saying *"I have new SOS data."*
2. **Phone B Picks It Up (\`TTL = 4, Hop = 1\`)**: Phone B connects over BLE, receives the 180 bytes, checks the signature, and makes sure it hasn't seen this \`Message ID\` before. It subtracts \`1\` from \`TTL\` (\`5 -> 4\`), adds \`1\` to \`Hop Count\` (\`0 -> 1\`), and saves it to its own SQLite outbox.
3. **Surviving the Dead Zone (Store-and-Forward)**: Phone B walks up a concrete stairwell where **zero phones** are in range. Even if the app screen is off, the message is safely stored on disk in SQLite (\`WRITE_AHEAD_LOGGING\` mode) so nothing is lost.
4. **Phone C Receives the SOS (\`TTL = 3, Hop = 2\`)**: When Phone B walks near Phone C, Phone B forwards the saved packet. Phone C verifies Phone A's original signature, displays the emergency GPS location on screen, and counts \`TTL\` down to \`3\`. When a packet's \`TTL\` eventually reaches \`0\`, phones display it locally and stop forwarding it.

---

## 3. Three Edge-Case Failures & How We Recover

### 1. Bluetooth Drops Mid-Message (\`GATT Error 133\` During Multi-Chunk Send)
* **What Goes Wrong:** Longer medical messages (for example, 4 chunks = \`720 bytes\`) can get cut off halfway when two people walk past each other, throwing Android's common \`GATT status=133\` disconnect error.
* **Why Naive Apps Fail:** Basic apps throw away partial chunks in memory and restart from Chunk 1 every time, wasting battery and never finishing the transfer.
* **How Leyline Recovers:**
  * Every chunk that arrives is immediately saved in a \`chunk_staging\` SQLite table along with a simple checklist (\`bitmask\`) of which pieces arrived (e.g., Chunks \`1\` and \`2\` received; \`3\` and \`4\` missing).
  * We immediately call \`gatt.close()\` to free the broken Bluetooth socket (preventing Android's 32-connection limit crash) and retry after a short pause.
  * On reconnect, the receiver shares its checklist so the sender **only sends the missing chunks** (\`3\` and \`4\`).

### 2. SQLite Outbox Fills Up During a Long Blackout
* **What Goes Wrong:** If hundreds of people are stuck in a shelter for 12+ hours sending status messages, the phone's outbox database could grow endlessly and crash the app—or delete older life-saving SOS messages to make room for casual messages.
* **How Leyline Recovers:**
  * We cap the outbox at **4,096 packets** (\`~737 KB\` total).
  * **SOS Protection Rule:** Messages with \`SOS Flag = 1\` are locked in a protected zone. If the database gets full, the app deletes **non-SOS** messages first—starting with packets that have the lowest \`TTL\` and highest \`Hop Count\` (the ones closest to expiring anyway).

### 3. Infinite Broadcast Loops (\`Phone A -> Phone B -> Phone C -> Phone A\`)
* **What Goes Wrong:** When many phones stand in a circle, Phone C can broadcast Phone A's own message right back to Phone A and Phone B, creating an endless echo storm that jams Bluetooth for everyone.
* **How Leyline Recovers:**
  * **Seen-Message Memory (\`seen_packets\`):** Every phone keeps a fast lookup list of \`Message ID\`s it has already created or forwarded. If the same \`Message ID\` comes back around, it is ignored in less than a millisecond.
  * **Outbox Fingerprint Check:** Each phone's Bluetooth advertisement carries a tiny \`4-byte\` summary (CRC32 digest) of its outbox. If two phones have the exact same summary, they don't even open a Bluetooth connection.
  * **TTL Hard Limit + Random Delay:** \`TTL\` always counts down to \`0\`, and each phone waits a tiny random delay (\`60ms–340ms\`) before advertising updates so nearby phones don't collide on the airwaves.

---

## 4. Physical 3-Phone Test Log (Airplane Mode ON)

Recorded over USB (\`adb logcat\`) using three real Android phones with SIM cards removed, Wi-Fi turned off, and **Airplane Mode ON** (\`AirplaneMode=1\`), with only Bluetooth turned back on:

* **NODE-A (Sender):** Google Pixel 7a — Basement stairwell
* **NODE-B (Messenger):** Nothing Phone (2) — Walking up stairs to courtyard
* **NODE-C (Responder):** Samsung Galaxy S23 — Courtyard rescue table (\`42m\` away)

\`\`\`log
${TEST_LOG_RAW}
\`\`\`

---

## 5. Modular Project Structure

\`\`\`text
${REPO_TREE_ASCII}
\`\`\`

---

## 6. Tool & Library Disclosure (100% Offline, Zero Cloud)

Leyline Relay uses **ZERO cloud services**, **ZERO closed-source mesh SDKs** (no Firebase, no Google Play Services, no Bridgefy), and **completely removes \`android.permission.INTERNET\` from \`AndroidManifest.xml\`** so judges can verify it cannot touch the internet.

| Part of the App | Official Android / Open-Source Tool | What We Use It For |
| :--- | :--- | :--- |
| **Bluetooth Scanning** | \`BluetoothLeScanner\` (Android SDK) | Finds nearby Leyline phones using hardware filters to save battery. |
| **Bluetooth Beacons** | \`BluetoothLeAdvertiser\` (Android SDK) | Broadcasts a small 24-byte signal advertising whether we carry new SOS alerts. |
| **Packet Transfer** | \`BluetoothGatt\` & \`BluetoothGattServer\` | Negotiates the \`185-byte\` transfer size and sends the \`180-byte\` packet phone-to-phone. |
| **Background Relay** | Android \`ForegroundService\` (\`connectedDevice\`) | Keeps Bluetooth relaying working while phones are locked in pockets. |
| **Offline Outbox** | **Jetpack Room** (\`androidx.room\` SQLite) | Saves messages safely on disk during signal blackouts (\`WAL\` crash-safe mode). |
| **Async Tasks** | **Kotlin Coroutines & Flow** | Handles multiple Bluetooth events smoothly without freezing the screen. |
| **Binary Packing** | \`java.nio.ByteBuffer\` | Packs fields cleanly into exact byte positions (\`0–179\`). |
| **Signatures** | \`java.security\` (\`Ed25519\`) | Signs and verifies SOS packets completely offline without internet certificates. |

---

## License

Released under the **Apache License 2.0** for **Droidrush 2026 — Problem Statement 07 ("The Blackout Leyline")**.
`;
