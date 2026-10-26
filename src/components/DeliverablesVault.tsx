import React, { useState } from 'react';
import { Check, Copy, Download, FileCode, FileText } from 'lucide-react';
import {
  FAILURE_MODES,
  KOTLIN_FILES,
  PACKET_FIELDS,
  README_MARKDOWN,
  REPO_TREE_ASCII,
  TEST_LOG_RAW,
  TOOL_DISCLOSURE
} from '../data/leylineDeliverables';

function triggerDownload(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const SETTINGS_GRADLE_CODE = `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "leyline-relay"

include(":app")
include(":wire-protocol")
include(":routing-engine")
include(":database")
include(":ble-core")`;

const MANIFEST_XML_CODE = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <!--
      STRICT ZERO-CLOUD GUARANTEE (Droidrush 2026 Problem Statement 07):
      android.permission.INTERNET and ACCESS_NETWORK_STATE are intentionally OMITTED.
      Verifiable via: aapt dump permissions app-release.apk
    -->
    <uses-feature
        android:name="android.hardware.bluetooth_le"
        android:required="true" />

    <uses-permission
        android:name="android.permission.BLUETOOTH_SCAN"
        android:usesPermissionFlags="neverForLocation" />
    <uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE" />

    <application
        android:name=".LeylineApplication"
        android:allowBackup="false"
        android:label="Leyline Relay"
        android:supportsRtl="true">

        <service
            android:name=".service.MeshRelayForegroundService"
            android:enabled="true"
            android:exported="false"
            android:foregroundServiceType="connectedDevice" />
    </application>
</manifest>`;

interface RepoFileEntry {
  id: string;
  filename: string;
  path: string;
  kind: 'markdown' | 'code';
  summary: string;
  content: string;
}

const REPO_FILES: RepoFileEntry[] = [
  {
    id: 'readme-md',
    filename: 'README.md',
    path: 'README.md',
    kind: 'markdown',
    summary: 'Complete Droidrush 2026 submission README with binary spec, TTL proof, 3 failure recoveries, Logcat & tool audit.',
    content: README_MARKDOWN
  },
  {
    id: 'mesh-router',
    filename: 'MeshRouter.kt',
    path: 'routing-engine/src/main/kotlin/net/leylinerelay/routing/MeshRouter.kt',
    kind: 'code',
    summary: KOTLIN_FILES[0].summary,
    content: KOTLIN_FILES[0].code
  },
  {
    id: 'ble-advertiser',
    filename: 'BleAdvertiser.kt',
    path: 'ble-core/src/main/kotlin/net/leylinerelay/ble/BleAdvertiser.kt',
    kind: 'code',
    summary: KOTLIN_FILES[1].summary,
    content: KOTLIN_FILES[1].code
  },
  {
    id: 'ble-scanner',
    filename: 'BleScanner.kt',
    path: 'ble-core/src/main/kotlin/net/leylinerelay/ble/BleScanner.kt',
    kind: 'code',
    summary: KOTLIN_FILES[2].summary,
    content: KOTLIN_FILES[2].code
  },
  {
    id: 'manifest-xml',
    filename: 'AndroidManifest.xml',
    path: 'app/src/main/AndroidManifest.xml',
    kind: 'code',
    summary: 'Zero-Internet manifest declaring BLE hardware permissions and connectedDevice foreground service.',
    content: MANIFEST_XML_CODE
  },
  {
    id: 'settings-gradle',
    filename: 'settings.gradle.kts',
    path: 'settings.gradle.kts',
    kind: 'code',
    summary: '5-module Gradle build configuration isolating :wire-protocol, :routing-engine, :database, :ble-core, and :app.',
    content: SETTINGS_GRADLE_CODE
  }
];

export const DeliverablesVault: React.FC = () => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [readmeMode, setReadmeMode] = useState<'rendered' | 'raw'>('rendered');
  const [selectedFileId, setSelectedFileId] = useState<string>('readme-md');

  const selectedFile =
    REPO_FILES.find((f) => f.id === selectedFileId) ?? REPO_FILES[0];

  const copyText = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(key);
    setTimeout(() => setCopiedId(null), 1800);
  };

  return (
    <div className="space-y-16">
      {/* 01. GitHub Repository Explorer + Complete README.md */}
      <section id="readme-spec" className="scroll-mt-24 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-100 tracking-tight">
              01. Repository Files &amp; Judge-Compliant README.md
            </h2>
            <p className="text-sm text-slate-400 mt-1 max-w-3xl">
              Browse <code className="text-amber-300">README.md</code> (rendered preview or raw Markdown source) alongside the foundational Kotlin protocol interfaces, <code className="text-slate-200">AndroidManifest.xml</code>, and Gradle module configuration.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {selectedFile.id === 'readme-md' && (
              <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => setReadmeMode('rendered')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    readmeMode === 'rendered'
                      ? 'bg-slate-800 text-slate-100 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Rendered Preview
                </button>
                <button
                  type="button"
                  onClick={() => setReadmeMode('raw')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    readmeMode === 'raw'
                      ? 'bg-slate-800 text-slate-100 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Raw Markdown
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => copyText(selectedFile.id, selectedFile.content)}
              className="px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-500 rounded-lg hover:bg-amber-400 transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              {copiedId === selectedFile.id ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              {copiedId === selectedFile.id
                ? `Copied ${selectedFile.filename}`
                : `Copy ${selectedFile.filename}`}
            </button>

            <button
              type="button"
              onClick={() => triggerDownload(selectedFile.filename, selectedFile.content)}
              className="px-3.5 py-2 text-xs font-medium text-slate-200 bg-slate-900 border border-slate-700 rounded-lg hover:border-slate-500 transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Download {selectedFile.filename}
            </button>
          </div>
        </div>

        {/* Interactive Repository File Strip */}
        <div
          id="kotlin-interfaces"
          className="scroll-mt-24 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"
        >
          {/* Sidebar File List */}
          <div className="lg:col-span-4 border border-slate-800 bg-slate-900/50 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between text-xs font-mono text-slate-400 bg-slate-950/60">
              <span>leyline-relay/</span>
              <span>{REPO_FILES.length} core files</span>
            </div>
            <div className="divide-y divide-slate-800/80">
              {REPO_FILES.map((file) => {
                const active = file.id === selectedFile.id;
                return (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => setSelectedFileId(file.id)}
                    className={`w-full text-left px-4 py-3.5 transition-colors flex items-start gap-3 ${
                      active ? 'bg-amber-500/10' : 'hover:bg-slate-900/80'
                    }`}
                  >
                    {file.kind === 'markdown' ? (
                      <FileText
                        className={`w-4 h-4 mt-0.5 shrink-0 ${
                          active ? 'text-amber-400' : 'text-slate-400'
                        }`}
                      />
                    ) : (
                      <FileCode
                        className={`w-4 h-4 mt-0.5 shrink-0 ${
                          active ? 'text-amber-400' : 'text-slate-400'
                        }`}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-xs font-mono font-semibold truncate ${
                            active ? 'text-amber-300' : 'text-slate-100'
                          }`}
                        >
                          {file.filename}
                        </span>
                        <span className="text-[11px] font-mono text-slate-500 tabular-nums shrink-0">
                          {file.content.split('\n').length}L
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 truncate mt-0.5">
                        {file.path}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active File Content Pane */}
          <div className="lg:col-span-8 border border-slate-800 bg-slate-950 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-800 bg-slate-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-mono text-slate-400">
              <span className="text-slate-200">{selectedFile.path}</span>
              <span className="truncate">{selectedFile.summary}</span>
            </div>

            {selectedFile.id === 'readme-md' && readmeMode === 'rendered' ? (
              <div className="p-6 sm:p-8 space-y-8 text-sm text-slate-300 leading-relaxed max-h-[820px] overflow-y-auto">
                {/* Rendered README Hero */}
                <div className="border-b border-slate-800 pb-6 space-y-3">
                  <div className="text-xs font-mono text-amber-400">
                    README.md · Droidrush 2026 Problem Statement 07
                  </div>
                  <h3 className="text-2xl sm:text-3xl font-bold text-slate-50 tracking-tight">
                    Leyline Relay
                  </h3>
                  <p className="text-base font-semibold text-amber-300">
                    When towers fall and spectrum goes dark, every pocket becomes a relay tower.
                  </p>
                  <p className="text-sm text-slate-300">
                    Leyline Relay is a delay-tolerant, peer-to-peer Bluetooth Low Energy (BLE) mesh network for Android that routes cryptographically signed 180-byte SOS packets hop-by-hop in strict Airplane Mode without internet, Wi-Fi, or cellular infrastructure. By combining negotiated 185-byte GATT <code className="text-slate-100">WRITE_TYPE_NO_RESPONSE</code> bursts with a Write-Ahead-Logged (WAL) Room SQLite Store-and-Forward outbox, emergency frames survive radio blackouts and physical node mobility until reaching rescue responders.
                  </p>
                </div>

                {/* Rendered Section 1: Binary Packet Spec Table */}
                <div className="space-y-3">
                  <h4 className="text-base font-bold text-slate-100">
                    1. Binary Packet Specification (180-Byte Wire Frame)
                  </h4>
                  <p className="text-xs text-slate-400">
                    Negotiated <code className="text-slate-200">requestMtu(185)</code> yields <code className="text-slate-200">182B</code> usable ATT payload (<code className="text-slate-200">185B - 3B</code> ATT header). Serialized in <code className="text-slate-200">ByteOrder.BIG_ENDIAN</code>:
                  </p>
                  <div className="overflow-x-auto border border-slate-800 rounded-lg">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 bg-slate-900/80 text-slate-300">
                          <th className="py-2.5 px-3 font-semibold">Byte Offset</th>
                          <th className="py-2.5 px-3 font-semibold">Field</th>
                          <th className="py-2.5 px-3 font-semibold text-right">Bytes</th>
                          <th className="py-2.5 px-3 font-semibold">Wire Type</th>
                          <th className="py-2.5 px-3 font-semibold">Purpose &amp; Invariant</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80">
                        {PACKET_FIELDS.map((f) => (
                          <tr key={f.id}>
                            <td className="py-2 px-3 font-mono text-amber-300 whitespace-nowrap tabular-nums">
                              {f.offsetHex}
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-100 whitespace-nowrap">
                              {f.name}
                            </td>
                            <td className="py-2 px-3 font-mono text-right text-slate-200 tabular-nums">
                              {f.sizeBytes}
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-400 whitespace-nowrap">
                              {f.wireType}
                            </td>
                            <td className="py-2 px-3 text-slate-300">
                              {f.summary}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Rendered Section 2: Store-and-Forward ASCII Flow */}
                <div className="space-y-3">
                  <h4 className="text-base font-bold text-slate-100">
                    2. Store-and-Forward TTL Routing Proof (Node A → Node B → Node C)
                  </h4>
                  <pre className="p-4 rounded-lg bg-slate-900/90 border border-slate-800 font-mono text-[11px] leading-relaxed text-slate-200 overflow-x-auto">
{`[NODE A: Origin]               [NODE B: Data Mule]               [NODE C: Responder]
TTL=5, Hop=0, SOS=0x11         SQLite WAL Outbox                 Airplane Mode = 1
      |                                |                                 |
      |=== 180B GATT Write (MTU 185) =>| Verify Ed25519 (Origin A): OK   |
      |<-- 17B Receipt ACK ------------| SeenCache: MISS                 |
      X (Link severed in stairwell)    | decrementTTL: TTL 5->4, Hop 0->1|
                                       | WAL COMMIT (survives blackout)  |
                                       |~~~ 175s Zero-Peer Blackout ~~~~~|
                                       |=== 180B GATT Write (TTL=4) ====>| Verify Origin A Sig: OK
                                       |<-- 17B Receipt ACK -------------| Render SOS + Store TTL=3`}
                  </pre>
                </div>

                {/* Rendered Section 3: 3 Edge Cases */}
                <div className="space-y-3">
                  <h4 className="text-base font-bold text-slate-100">
                    3. Three Mandated Edge-Case Failure Modes &amp; Recoveries
                  </h4>
                  <div className="divide-y divide-slate-800 border border-slate-800 rounded-lg">
                    {FAILURE_MODES.map((m) => (
                      <div key={m.id} className="p-4 space-y-1.5">
                        <div className="text-xs font-semibold text-slate-100">
                          {m.number}. {m.title}
                        </div>
                        <p className="text-xs text-slate-400">{m.trigger}</p>
                        <p className="text-xs text-emerald-300/95">
                          Recovery: {m.recoverySteps.join(' ')}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Rendered Section 4: Logcat */}
                <div className="space-y-3">
                  <h4 className="text-base font-bold text-slate-100">
                    4. Multi-Device Physical Test Log (Airplane Mode = 1)
                  </h4>
                  <pre className="p-4 rounded-lg bg-slate-900/90 border border-slate-800 font-mono text-[11px] leading-relaxed text-slate-300 overflow-x-auto">
                    {TEST_LOG_RAW}
                  </pre>
                </div>

                {/* Rendered Section 5: Zero-Cloud Tool Disclosure */}
                <div className="space-y-3">
                  <h4 className="text-base font-bold text-slate-100">
                    5. Tool &amp; Dependency Disclosure (Zero External Cloud SDKs)
                  </h4>
                  <p className="text-xs text-slate-400">
                    <code className="text-emerald-300">android.permission.INTERNET</code> is explicitly omitted from <code className="text-slate-200">AndroidManifest.xml</code>.
                  </p>
                  <div className="overflow-x-auto border border-slate-800 rounded-lg">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 bg-slate-900/80 text-slate-300">
                          <th className="py-2.5 px-3 font-semibold">Subsystem</th>
                          <th className="py-2.5 px-3 font-semibold">Native API / Library</th>
                          <th className="py-2.5 px-3 font-semibold">Offline Role</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80">
                        {TOOL_DISCLOSURE.map((item) => (
                          <tr key={item.subsystem}>
                            <td className="py-2 px-3 font-medium text-slate-200 whitespace-nowrap">
                              {item.subsystem}
                            </td>
                            <td className="py-2 px-3 font-mono text-amber-300/95">
                              {item.artifact}
                            </td>
                            <td className="py-2 px-3 text-slate-300">{item.purpose}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-6 max-h-[820px] overflow-y-auto overflow-x-auto">
                <pre className="font-mono text-xs leading-relaxed text-slate-200 whitespace-pre select-all">
                  {selectedFile.content}
                </pre>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Modular Repository Folder Structure */}
      <section id="repo-structure" className="scroll-mt-24 space-y-5">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-100 tracking-tight">
              02. Modular Android Repository Folder Structure
            </h2>
            <p className="text-sm text-slate-400 mt-1 max-w-3xl">
              Strict Gradle multi-module boundaries isolating pure JVM unit-testable routing and wire codecs (<code className="text-slate-200">:routing-engine</code>, <code className="text-slate-200">:wire-protocol</code>) from hardware BLE radios (<code className="text-slate-200">:ble-core</code>) and Room WAL storage (<code className="text-slate-200">:database</code>).
            </p>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => copyText('tree', REPO_TREE_ASCII)}
              className="px-4 py-2 text-xs font-semibold text-slate-200 bg-slate-900 border border-slate-700 rounded-lg hover:border-slate-500 transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              {copiedId === 'tree' ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              {copiedId === 'tree' ? 'Copied Tree' : 'Copy ASCII Tree'}
            </button>
          </div>
        </div>

        <div className="border border-slate-800 bg-slate-950 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between text-xs font-mono text-slate-400">
            <span>leyline-relay/ · Multi-Module Gradle Hierarchy</span>
            <span>5 Isolated Modules · Unidirectional Dependency Graph</span>
          </div>
          <div className="p-6 overflow-x-auto">
            <pre className="font-mono text-xs leading-relaxed text-slate-200 select-all">
              {REPO_TREE_ASCII}
            </pre>
          </div>
        </div>
      </section>
    </div>
  );
};
