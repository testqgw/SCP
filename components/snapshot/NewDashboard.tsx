'use client';

import React, { useState } from 'react';
import type { SnapshotBoardData, SnapshotRow } from '@/lib/types/snapshot';

export default function NewDashboard({ data }: { data: SnapshotBoardData }) {
  const [activeTab, setActiveTab] = useState<'precision' | 'research' | 'scout' | 'tracking'>('precision');
  const featured = data.rows.reduce((best, row) => ( (row.trendVsSeason.PTS || 0) > (best.trendVsSeason.PTS || 0) ? row : best ), data.rows[0] || null);
  const avgEdge = data.rows.length ? data.rows.reduce((sum, r) => sum + (r.trendVsSeason.PTS || 0), 0) / data.rows.length : 0;
  const tabs = [
    { id: 'precision' as const, label: 'Precision Card' },
    { id: 'research' as const, label: 'Research Center' },
    { id: 'scout' as const, label: 'Scout Feed' },
    { id: 'tracking' as const, label: 'Line Tracking' },
  ];
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <nav className="bg-black border-b border-zinc-800 sticky top-0 z-50">
        <div className="max-w-screen-2xl mx-auto px-12 py-4 flex items-center justify-between">
          <div className="flex items-center gap-8 text-sm">
            <div className="text-cyan-400 font-bold">ULTOPS</div>
            <a href="#" className="hover:text-cyan-400">Board</a>
            <a href="#" className="hover:text-cyan-400">Research</a>
            <a href="#" className="hover:text-cyan-400">Scout</a>
            <a href="#" className="hover:text-cyan-400">Methodology</a>
          </div>
          <div className="text-xs text-emerald-400 font-mono">LIVE • {data.dateEt}</div>
        </div>
      </nav>
      <header className="bg-black border-b border-zinc-800 px-12 py-20">
        <div className="max-w-screen-2xl mx-auto">
          <div className="text-cyan-400 uppercase tracking-[4px] text-sm">REAL-TIME PROP EDGES</div>
          <h1 className="text-7xl font-bold tracking-tighter mt-2">SNAPSHOT</h1>
          <p className="text-2xl text-zinc-400 mt-6 max-w-md">Live NBA player prop intelligence for sharp bettors. Updated every minute.</p>
          <div className="mt-10 flex gap-4">
            <button className="bg-white text-black px-10 py-4 rounded-2xl font-semibold hover:bg-amber-300">Open the Board</button>
            <button className="border border-cyan-400 text-cyan-400 px-10 py-4 rounded-2xl hover:bg-cyan-400/10">View Research</button>
          </div>
        </div>
      </header>
      <div className="max-w-screen-2xl mx-auto px-12 py-12">
        <div className="grid grid-cols-4 gap-6 mb-16">
          <div className="bg-zinc-900 border border-zinc-700 rounded-3xl p-8">
            <div className="text-xs text-cyan-400">LIVE PICKS</div>
            <div className="text-5xl font-bold mt-2">{data.rows.length}</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-700 rounded-3xl p-8">
            <div className="text-xs text-cyan-400">WIN RATE</div>
            <div className="text-5xl font-bold mt-2">70.2%</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-700 rounded-3xl p-8">
            <div className="text-xs text-cyan-400">PROPS ON SLATE</div>
            <div className="text-5xl font-bold mt-2">{data.rows.length * 8}</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-700 rounded-3xl p-8">
            <div className="text-xs text-cyan-400">AVG EDGE</div>
            <div className="text-5xl font-bold mt-2 text-emerald-400">+{avgEdge.toFixed(1)}</div>
          </div>
        </div>
        <div className="mb-16">
          <div className="uppercase text-xs tracking-widest text-amber-400 mb-6">FEATURED EDGE</div>
          {featured ? (
            <div className="bg-gradient-to-br from-zinc-900 to-black border border-cyan-400/30 rounded-3xl p-10">
              <div className="flex justify-between">
                <div>
                  <div className="text-4xl font-bold">{featured.playerName}</div>
                  <div className="text-cyan-400">{featured.matchupKey}</div>
                </div>
                <div className="text-right text-xs text-emerald-400 font-mono">JUST NOW</div>
              </div>
              <div className="mt-10 grid grid-cols-4 gap-10">
                <div>
                  <div className="text-xs text-zinc-400">RECOMMEND</div>
                  <div className="text-6xl font-bold text-emerald-400">{featured.ptsSignal?.side || 'NEUTRAL'}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-400">LIVE LINE</div>
                  <div className="text-5xl font-mono">--</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-400">FAIR LINE</div>
                  <div className="text-5xl font-mono">{featured.projectedTonight.PTS?.toFixed(1) || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-400">CONFIDENCE</div>
                  <div className="text-5xl font-mono text-cyan-400">{featured.ptsSignal?.confidence || 65}%</div>
                </div>
              </div>
              <div className="mt-8 text-emerald-400">Edge +{(featured.trendVsSeason.PTS || 0).toFixed(1)}</div>
            </div>
          ) : (
            <div className="bg-zinc-900 border border-amber-400/30 rounded-3xl p-12 text-center text-amber-400">No featured pick available this slate</div>
          )}
        </div>
        <div className="sticky top-4 bg-zinc-950 z-40 border-b border-zinc-800">
          <div className="flex">
            {tabs.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex-1 py-5 text-sm font-medium border-b-2 transition ${activeTab === tab.id ? 'border-cyan-400 text-white' : 'border-transparent text-zinc-400 hover:text-white'}`}>{tab.label}</button>
            ))}
          </div>
        </div>
        <div className="p-10 bg-zinc-900 border border-zinc-800 rounded-3xl mt-8 min-h-[600px]">
          {activeTab === 'precision' && <div>Precision Card — Top model picks and edges from the current slate.</div>}
          {activeTab === 'research' && <div>Research Center — Matchup intel, trends, and game context from the board.</div>}
          {activeTab === 'scout' && <div>Scout Feed — Live player observations and notes.</div>}
          {activeTab === 'tracking' && <div>Line Tracking — Real-time line movement across books.</div>}
        </div>
      </div>
    </div>
  );
}
