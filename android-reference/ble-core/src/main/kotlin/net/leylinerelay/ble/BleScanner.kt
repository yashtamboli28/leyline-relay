package net.leylinerelay.ble

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
}
