package net.leylinerelay.routing

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
}
