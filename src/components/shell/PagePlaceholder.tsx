export function PagePlaceholder({ code, note }: { code: string; note?: string }) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--s3)',
      }}
    >
      <span className="microlabel" style={{ fontSize: 12 }}>
        {code}
      </span>
      <span className="mono" style={{ color: 'var(--text-3)' }}>
        {note ?? 'SECTOR STANDBY — FEEDS ARRIVE IN PHASE 3'}
      </span>
    </div>
  );
}
