package net.leylinerelay.ble

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
}
