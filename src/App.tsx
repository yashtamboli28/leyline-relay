/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { DeliverablesVault } from './components/DeliverablesVault';
import { PacketInspector } from './components/PacketInspector';
import { TtlMeshSimulator } from './components/TtlMeshSimulator';
import {
  KOTLIN_FILES,
  README_MARKDOWN,
  REPO_TREE_ASCII
} from './data/leylineDeliverables';

function triggerDownload(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadSubmissionBundle() {
  const combinedBundle = [
    '====================================================================',
    'LEYLINE RELAY — DROIDRUSH 2026 SUBMISSION REPOSITORY KIT',
    'Problem Statement 07: The Blackout Leyline',
    '====================================================================\n',
    '--- FILE 1: README.md ---\n',
    README_MARKDOWN,
    '\n--- FILE 2: REPOSITORY FOLDER STRUCTURE ---\n',
    REPO_TREE_ASCII,
    ...KOTLIN_FILES.flatMap((file) => [
      `\n\n--- FILE: ${file.packagePath} ---\n`,
      file.code
    ])
  ].join('\n');

  const blob = new Blob([combinedBundle], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'leyline-relay-droidrush2026-kit.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function App() {
  const [copiedHeroReadme, setCopiedHeroReadme] = useState<boolean>(false);

  const handleCopyFullReadme = async () => {
    await navigator.clipboard.writeText(README_MARKDOWN);
    setCopiedHeroReadme(true);
    setTimeout(() => setCopiedHeroReadme(false), 1800);
  };

  return (
    <div className="min-h-screen bg-[#0b111e] text-slate-200 flex flex-col">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-[#0b111e]/95 backdrop-blur border-b border-slate-800/90">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-8 px-6 py-4">
          <a
            href="#top"
            className="text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
          >
            Leyline Relay
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
            <a
              href="#readme-spec"
              className="hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              README.md
            </a>
            <a
              href="#repo-structure"
              className="hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Repo Structure
            </a>
            <a
              href="#kotlin-interfaces"
              className="hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Kotlin Interfaces
            </a>
            <a
              href="#packet-spec"
              className="hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              180B Packet Lab
            </a>
            <a
              href="#ttl-routing"
              className="hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              TTL Simulator
            </a>
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={handleCopyFullReadme}
              className="px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-500 rounded-lg hover:bg-amber-400 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              {copiedHeroReadme ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              {copiedHeroReadme ? 'Copied README.md' : 'Copy README.md'}
            </button>
          </div>
        </div>
      </header>

      <main id="top" className="flex-1 max-w-7xl w-full mx-auto px-6 py-12 space-y-20">
        {/* Hero Architecture Overview */}
        <section className="border-b border-slate-800 pb-12">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-400 mb-4">
            <span className="text-amber-400 font-semibold">Droidrush 2026</span>
            <span aria-hidden="true">·</span>
            <span>Problem Statement 07: The Blackout Leyline</span>
            <span aria-hidden="true">·</span>
            <span>Airplane-Mode Delay-Tolerant BLE Mesh</span>
            <span aria-hidden="true">·</span>
            <span>Zero Cloud Dependencies</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-end">
            <div className="lg:col-span-8 space-y-4">
              <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-slate-50 text-balance leading-tight">
                When cell towers fail, nearby phones become the network.
              </h1>
              <p className="text-base text-slate-300 leading-relaxed max-w-3xl">
                Leyline Relay sends emergency SOS alerts from phone to phone over Bluetooth Low Energy (BLE) in Airplane Mode—with zero internet, Wi-Fi, or mobile signal. If no rescue team is nearby, each phone saves the message in its local SQLite database and automatically passes it forward when another phone walks into range.
              </p>
            </div>

            <div className="lg:col-span-4 flex flex-col sm:flex-row lg:flex-col gap-3">
              <button
                type="button"
                onClick={() => triggerDownload('README.md', README_MARKDOWN)}
                className="w-full py-2.5 px-4 text-xs font-semibold text-slate-950 bg-amber-500 rounded-lg hover:bg-amber-400 transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <Download className="w-4 h-4" />
                Download README.md
              </button>
              <button
                type="button"
                onClick={downloadSubmissionBundle}
                className="w-full py-2.5 px-4 text-xs font-semibold text-slate-200 bg-slate-900 border border-slate-700 rounded-lg hover:border-slate-500 transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <Download className="w-4 h-4" />
                Download Full Submission Kit
              </button>
            </div>
          </div>

          {/* Quantitative Wire Invariants Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 pt-10 mt-10 border-t border-slate-800/80">
            <div>
              <div className="text-xs text-slate-400">Atomic BLE Wire Chunk</div>
              <div className="text-2xl font-bold font-mono text-slate-100 mt-1 tabular-nums">
                180 Bytes
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                Fits 185B negotiated ATT MTU (182B L2CAP ceiling)
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">End-to-End Authenticity</div>
              <div className="text-2xl font-bold font-mono text-slate-100 mt-1 tabular-nums">
                64B Ed25519
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                Immutable pre-image excludes mutable TTL &amp; hopCount
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">SQLite WAL Outbox Quota</div>
              <div className="text-2xl font-bold font-mono text-slate-100 mt-1 tabular-nums">
                4,096 Frames
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                SOS-pinned partition immune to ambient flood eviction
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">External Cloud / Internet Perm</div>
              <div className="text-2xl font-bold font-mono text-emerald-400 mt-1 tabular-nums">
                0 SDKs
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                android.permission.INTERNET omitted from Manifest
              </div>
            </div>
          </div>
        </section>

        {/* Primary Section 01 & 02: README.md Viewer + Repository File Explorer + ASCII Tree */}
        <DeliverablesVault />

        {/* Interactive 180-Byte Binary Packet Specification */}
        <section id="packet-spec" className="scroll-mt-24 space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-slate-100 tracking-tight">
              03. Interactive 180-Byte Binary Packet Specification
            </h2>
            <p className="text-sm text-slate-400 mt-1 max-w-3xl">
              Inspect exact byte boundaries (<code className="text-slate-200">0x00..0xB3</code>) in <code className="text-slate-200">ByteOrder.BIG_ENDIAN</code> and test how intermediate hops mutate <code className="text-sky-300">ttl</code> and <code className="text-sky-300">hop_count</code> without invalidating the origin signature.
            </p>
          </div>
          <PacketInspector />
        </section>

        {/* Interactive Store-and-Forward TTL Routing Proof + 3 Failure Modes + Logcat */}
        <section id="ttl-routing" className="scroll-mt-24 space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-slate-100 tracking-tight">
              04. Store-and-Forward TTL Simulator &amp; Physical Test Log
            </h2>
            <p className="text-sm text-slate-400 mt-1 max-w-3xl">
              Step through the 3-node opportunistic relay (<code className="text-slate-200">Node A → Node B → Node C</code>), audit the three judge-mandated failure recoveries, and filter the physical 3-handset Logcat capture.
            </p>
          </div>
          <TtlMeshSimulator />
        </section>
      </main>

      <footer className="border-t border-slate-800/80 py-8 px-6 mt-16">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <span>Leyline Relay · Droidrush 2026 Problem Statement 07 ("The Blackout Leyline")</span>
          <span>Apache-2.0 Open-Source Submission Kit · Native Android BLE + Jetpack Room WAL</span>
        </div>
      </footer>
    </div>
  );
}
