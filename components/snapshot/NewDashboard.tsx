'use client';
import type { SnapshotBoardData } from '@/lib/types/snapshot';

export default function NewDashboard({ data }: { data: SnapshotBoardData }) {
  return (
    <div className='min-h-screen bg-zinc-950 text-white p-8'>
      <div className='max-w-6xl mx-auto'>
        <h1 className='text-5xl font-bold mb-6'>Snapshot Dashboard v1</h1>
        <div className='mb-8 text-zinc-400'>
          Date: {data.dateEt} | {data.rows.length} projections loaded
        </div>
        <div className='bg-zinc-900 rounded-2xl p-6 border border-zinc-700'>
          <div className='text-sm opacity-70 mb-4'>Top players by PTS projection</div>
          {data.rows.slice(0,15).map(r => (
            <div key={r.playerId} className='flex justify-between py-2 border-b border-zinc-800 last:border-0'>
              <span>{r.playerName}</span>
              <span className='font-mono'>{r.matchupKey} • PTS: {r.projectedTonight.PTS?.toFixed(1)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

