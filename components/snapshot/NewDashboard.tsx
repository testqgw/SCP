'use client';

import React, { useState } from 'react';
import type { SnapshotBoardData } from '@/lib/types/snapshot';

export default function NewDashboard({ data }: { data: SnapshotBoardData }) {
  const [activeTab, setActiveTab] = useState<'precision' | 'research' | 'scout' | 'tracking'>('precision');
  const featured = data.rows[0] || null;
  const tabs = [
    { id: 'precision' as const, label: 'Precision Card' },
    { id: 'research' as const, label: 'Research Center' },
    { id: 'scout' as const, label: 'Scout Feed' },
    { id: 'tracking' as const, label: 'Line Tracking' },
  ];
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <header className="bg-black border-b border-zinc-800 px-12 py-16">
        <div className="max-w-6xl mx-auto">
          <div className="text-cyan-400 uppercase tracking-widest text-sm mb-2">LIVE</div>
          <h1 className="text-6xl font-bold tracking-tighter">SNAPSHOT</h1>
          <p className="text-xl text-zinc-400 mt-3">Premium NBA Player Prop Intelligence</p>
          <div className="flex gap-4 mt-10">
            <button className="bg-white text-black px-10 py-4 rounded-2xl font-semibold">Open the Board</button>
            <button className="border border-white/30 px-10 py-4 rounded-2xl">Get the Report</button>
          </div>
        </div>
      </header>
      <div className="max-w-6xl mx-auto px-12 py-12">
        <div className="grid grid-cols-4 gap-6 mb-16">
          <div className="bg-zinc-900 p-6 rounded-3xl">
            <div className="text-xs text-cyan-400">LIVE PICKS</div>
            <div className="text-5xl font-bold">{data.rows.length}</div>
          </div>
          <div className="bg-zinc-900 p-6 rounded-3xl">
            <div className="text-xs text-cyan-400">WIN RATE</div>
            <div className="text-5xl font-bold">70.2%</div>
          </div>
          <div className="bg-zinc-900 p-6 rounded-3xl">
            <div className="text-xs text-cyan-400">PROPS</div>
            <div className="text-5xl font-bold">{data.rows.length * 4}</div>
          </div>
          <div className="bg-zinc-900 p-6 rounded-3xl">
            <div className="text-xs text-cyan-400">EDGE</div>
            <div className="text-5xl font-bold text-emerald-400">+4.2</div>
          </div>
        </div>
        {featured && (
          <div className="mb-16 bg-zinc-900 border border-cyan-400/30 rounded-3xl p-8">
            <div className="text-amber-400 uppercase text-xs tracking-widest mb-4">FEATURED PICK</div>
            <div className="text-3xl font-bold">{featured.playerName}</div>
            <div className="text-cyan-400">{featured.matchupKey}</div>
            <div className="mt-6 text-4xl font-mono">PTS {featured.projectedTonight.PTS?.toFixed(1)}</div>
          </div>
        )}
        <div className="flex border-b border-zinc-800 mb-8">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-10 py-5 text-sm font-medium border-b-2 ${activeTab === tab.id ? 'border-cyan-400 text-white' : 'border-transparent text-zinc-400'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="p-8 bg-zinc-900 rounded-3xl">
          Tab content for {activeTab} would go here.
        </div>
      </div>
    </div>
  );
}
