import React, { useMemo, useState } from 'react';
import { PACKET_FIELDS, PacketFieldSpec } from '../data/leylineDeliverables';

function fnv1aHashBytes(input: string, length: number, seedOffset = 0): Uint8Array {
  const out = new Uint8Array(length);
  let h = (0x811c9dc5 ^ seedOffset) >>> 0;
  for (let i = 0; i < length; i++) {
    const ch = input.charCodeAt(i % Math.max(1, input.length)) ^ ((i * 31 + seedOffset) & 0xff);
    h ^= ch;
    h = Math.imul(h, 0x01000193) >>> 0;
    out[i] = (h >>> ((i % 4) * 8)) & 0xff;
  }
  return out;
}

export const PacketInspector: React.FC = () => {
  const [selectedFieldId, setSelectedFieldId] = useState<string>('ttl');
  const [isSos, setIsSos] = useState<boolean>(true);
  const [ttl, setTtl] = useState<number>(5);
  const [hopCount, setHopCount] = useState<number>(1);
  const [chunkIndex, setChunkIndex] = useState<number>(0);
  const [totalChunks, setTotalChunks] = useState<number>(1);
  const [emergencyText, setEmergencyText] = useState<string>(
    'Structural collapse Stairwell B, 2 injured, water needed'
  );

  const wireBytes = useMemo(() => {
    const buf = new Uint8Array(180);
    const view = new DataView(buf.buffer);

    // 0x00..0x0F: Deterministic UUIDv7 bytes (019384e0-7b12-7c90-8a11-44d90218ef7a)
    const uuidHex = '019384e07b127c908a1144d90218ef7a';
    for (let i = 0; i < 16; i++) {
      buf[i] = parseInt(uuidHex.slice(i * 2, i * 2 + 2), 16);
    }

    // 0x10..0x17: Sender ID (8F21A409C311E04A)
    const senderHex = '8f21a409c311e04a';
    for (let i = 0; i < 8; i++) {
      buf[16 + i] = parseInt(senderHex.slice(i * 2, i * 2 + 2), 16);
    }

    // 0x18: TTL (1B)
    buf[24] = ttl & 0xff;

    // 0x19: Hop Count (1B)
    buf[25] = hopCount & 0xff;

    // 0x1A: SOS Flag (Proto v1 = 0x10 |ACK_REQ=0x02 | IS_SOS=0x01)
    buf[26] = 0x10 | 0x02 | (isSos ? 0x01 : 0x00);

    // 0x1B: Chunk Meta ((chunkIdx << 4) | (totalChunks - 1))
    buf[27] = ((chunkIndex & 0x0f) << 4) | ((Math.max(1, totalChunks) - 1) & 0x0f);

    // 0x1C..0x73: 88B Payload -> Lat (28.5450120 => 285450120), Lon (77.1926440 => 771926440), Battery 84% (0x0054), 78B UTF-8
    view.setInt32(28, 285450120, false); // Big-Endian
    view.setInt32(32, 771926440, false); // Big-Endian
    view.setUint16(36, 84, false);

    const encoder = new TextEncoder();
    const encodedMsg = encoder.encode(emergencyText);
    for (let i = 0; i < 78; i++) {
      buf[38 + i] = i < encodedMsg.length ? encodedMsg[i] : 0x00;
    }

    // 0x74..0xB3: 64B Deterministic Ed25519 Signature derived ONLY from immutable bytes (excluding 24 & 25!)
    const immutableDescriptor = `${uuidHex}:${senderHex}:${buf[26]}:${buf[27]}:${emergencyText.slice(0, 78)}`;
    const sig = fnv1aHashBytes(immutableDescriptor, 64, 0x77fd);
    buf.set(sig, 116);

    return buf;
  }, [isSos, ttl, hopCount, chunkIndex, totalChunks, emergencyText]);

  const selectedField: PacketFieldSpec =
    PACKET_FIELDS.find((f) => f.id === selectedFieldId) ?? PACKET_FIELDS[0];

  const diameterValid = ttl > 0 && ttl + hopCount <= 16;

  const fieldStyle = (field: PacketFieldSpec, active: boolean) => {
    if (active) {
      return 'bg-amber-500/20 border-amber-400 text-amber-200';
    }
    if (!field.signedInEd25519) {
      return 'bg-sky-500/10 border-sky-500/40 text-sky-200 hover:border-sky-400';
    }
    return 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600';
  };

  return (
    <div className="space-y-8">
      {/* Live Frame Controls */}
      <div className="border border-slate-800 bg-slate-900/60 rounded-xl p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-6 border-b border-slate-800">
          <div>
            <h3 className="text-lg font-semibold text-slate-100">
              Interactive 180-Byte GATT Wire Frame Encoder
            </h3>
            <p className="text-sm text-slate-400 mt-1">
              Mutate hop headers or payload below. Notice bytes <code className="text-sky-300">0x18</code> (TTL) and{' '}
              <code className="text-sky-300">0x19</code> (Hop Count) update without altering the 64-byte origin Ed25519 signature (<code className="text-amber-300">0x74..0xB3</code>).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-slate-400 shrink-0">
            <span>ATT MTU: 185 B</span>
            <span aria-hidden="true">·</span>
            <span>Max ATT Write: 182 B</span>
            <span aria-hidden="true">·</span>
            <span className="text-amber-300 font-semibold">Wire Frame: 180 B</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 pt-6">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">
              Priority Flag (<code className="text-slate-300">0x1A</code>)
            </label>
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setIsSos(true);
                  setSelectedFieldId('sos_flag');
                }}
                className={`py-2 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  isSos
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                SOS (0x13)
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsSos(false);
                  setSelectedFieldId('sos_flag');
                }}
                className={`py-2 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  !isSos
                    ? 'bg-slate-800 text-slate-100 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Standard (0x12)
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs font-medium text-slate-400 mb-2">
              <span>TTL Remaining (<code className="text-sky-300">0x18</code>)</span>
              <span className="font-mono text-slate-200 tabular-nums">{ttl} hops</span>
            </div>
            <input
              type="range"
              min={0}
              max={15}
              value={ttl}
              onChange={(e) => {
                setTtl(Number(e.target.value));
                setSelectedFieldId('ttl');
              }}
              className="w-full accent-amber-500 cursor-pointer"
            />
            <div className="flex justify-between text-[11px] font-mono text-slate-500 mt-1">
              <span>0 (Drop)</span>
              <span>Default SOS: 7</span>
              <span>15</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs font-medium text-slate-400 mb-2">
              <span>Hop Count (<code className="text-sky-300">0x19</code>)</span>
              <span className="font-mono text-slate-200 tabular-nums">{hopCount} traversed</span>
            </div>
            <input
              type="range"
              min={0}
              max={15}
              value={hopCount}
              onChange={(e) => {
                setHopCount(Number(e.target.value));
                setSelectedFieldId('hop_count');
              }}
              className="w-full accent-sky-400 cursor-pointer"
            />
            <div className="flex justify-between text-[11px] font-mono text-slate-500 mt-1">
              <span>Origin: 0</span>
              <span className={diameterValid ? 'text-emerald-400' : 'text-rose-400'}>
                {diameterValid ? `Sum ${ttl + hopCount} <= 16 OK` : ttl === 0 ? 'TTL=0 Dropped' : `Sum ${ttl + hopCount} > 16 Invalid`}
              </span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs font-medium text-slate-400 mb-2">
              <span>Chunk Descriptor (<code className="text-slate-300">0x1B</code>)</span>
              <span className="font-mono text-slate-200 tabular-nums">
                {chunkIndex + 1}/{totalChunks} (0x{wireBytes[27].toString(16).padStart(2, '0').toUpperCase()})
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setChunkIndex(0);
                  setTotalChunks(1);
                  setSelectedFieldId('chunk_meta');
                }}
                className={`flex-1 py-2 px-3 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                  totalChunks === 1
                    ? 'border-amber-500/60 bg-amber-500/10 text-amber-200'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'
                }`}
              >
                1/1 Atomic
              </button>
              <button
                type="button"
                onClick={() => {
                  setChunkIndex(1);
                  setTotalChunks(4);
                  setSelectedFieldId('chunk_meta');
                }}
                className={`flex-1 py-2 px-3 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                  totalChunks === 4
                    ? 'border-amber-500/60 bg-amber-500/10 text-amber-200'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'
                }`}
              >
                2/4 Multi-Chunk
              </button>
            </div>
          </div>
        </div>

        <div className="mt-5 pt-5 border-t border-slate-800 flex flex-col sm:flex-row sm:items-center gap-4">
          <label htmlFor="sos-payload-input" className="text-xs font-medium text-slate-400 whitespace-nowrap">
            Emergency UTF-8 Body (max 78B after 10B GPS/Telemetry prefix):
          </label>
          <input
            id="sos-payload-input"
            type="text"
            maxLength={78}
            value={emergencyText}
            onChange={(e) => {
              setEmergencyText(e.target.value);
              setSelectedFieldId('payload');
            }}
            className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-sm font-mono text-slate-100 focus:outline-none focus:border-amber-500"
          />
          <span className="text-xs font-mono text-slate-400 tabular-nums shrink-0">
            {new TextEncoder().encode(emergencyText).length}/78 B
          </span>
        </div>
      </div>

      {/* Field Selector Architecture Strip + Active Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 border border-slate-800 bg-slate-900/40 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-200">
              180-Byte Binary Layout (Click Field to Inspect)
            </span>
            <span className="text-xs text-slate-400">
              Amber: Active · Sky: Mutable Hop Header · Slate: Signed Immutable
            </span>
          </div>
          <div className="divide-y divide-slate-800">
            {PACKET_FIELDS.map((field) => {
              const active = field.id === selectedField.id;
              return (
                <button
                  key={field.id}
                  type="button"
                  onClick={() => setSelectedFieldId(field.id)}
                  className={`w-full text-left px-5 py-3.5 transition-colors flex items-center justify-between gap-4 ${
                    active ? 'bg-amber-500/10' : 'hover:bg-slate-900/80'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs text-amber-400 tabular-nums w-24 shrink-0">
                        {field.offsetHex}
                      </span>
                      <span className="font-mono text-sm font-semibold text-slate-100">
                        {field.name}
                      </span>
                      <span className="text-xs text-slate-400 hidden sm:inline">
                        · {field.wireType}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1 truncate">{field.summary}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-mono text-xs font-semibold text-slate-200 tabular-nums">
                      {field.sizeBytes} B
                    </span>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {field.signedInEd25519 ? 'Signed' : 'Mutable'}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Live Hex Dump & Selected Field Detail */}
        <div className="lg:col-span-5 space-y-6">
          <div className={`border rounded-xl p-5 ${fieldStyle(selectedField, true)}`}>
            <div className="flex items-center justify-between gap-2 text-xs font-mono">
              <span>Offset {selectedField.offsetHex} ({selectedField.startByte}–{selectedField.endByte})</span>
              <span>{selectedField.sizeBytes} Bytes · {selectedField.signedInEd25519 ? 'Ed25519 Covered' : 'Hop-Mutable'}</span>
            </div>
            <h4 className="text-base font-semibold text-slate-100 mt-2 font-mono">
              {selectedField.name} : {selectedField.wireType}
            </h4>
            <p className="text-sm text-slate-300 mt-2 leading-relaxed">
              {selectedField.summary}
            </p>
            <div className="mt-3 pt-3 border-t border-amber-400/20 text-xs text-slate-300">
              <span className="font-semibold text-amber-300">Validation Invariant: </span>
              {selectedField.invariant}
            </div>
          </div>

          <div className="border border-slate-800 bg-slate-950 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-300">
                Live Big-Endian Wire Hex Frame (180 Bytes)
              </span>
              <span className="text-xs font-mono text-slate-500 tabular-nums">
                0x00 .. 0xB3
              </span>
            </div>
            <div className="grid grid-cols-12 gap-1 font-mono text-[11px] leading-tight select-all">
              {Array.from(wireBytes).map((byteVal, idx) => {
                const inSelected =
                  idx >= selectedField.startByte && idx <= selectedField.endByte;
                const isMutableHopByte = idx === 24 || idx === 25;
                return (
                  <span
                    key={idx}
                    onClick={() => {
                      const owner = PACKET_FIELDS.find(
                        (f) => idx >= f.startByte && idx <= f.endByte
                      );
                      if (owner) setSelectedFieldId(owner.id);
                    }}
                    title={`Byte ${idx} (0x${idx.toString(16).padStart(2, '0').toUpperCase()})`}
                    className={`text-center py-1 rounded cursor-pointer transition-colors tabular-nums ${
                      inSelected
                        ? 'bg-amber-500 text-slate-950 font-semibold'
                        : isMutableHopByte
                        ? 'bg-sky-500/20 text-sky-300'
                        : idx >= 116
                        ? 'bg-slate-900 text-emerald-300/90'
                        : 'bg-slate-900/60 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {byteVal.toString(16).padStart(2, '0').toUpperCase()}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
