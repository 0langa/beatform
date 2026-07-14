interface IconProps {
  size?: number;
}

function svg(size: number | undefined, path: React.ReactNode, viewBox = "0 0 24 24") {
  return (
    <svg
      width={size ?? 18}
      height={size ?? 18}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {path}
    </svg>
  );
}

export const IconPlay = ({ size }: IconProps) =>
  svg(size, <path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none" />);

export const IconPause = ({ size }: IconProps) =>
  svg(
    size,
    <>
      <rect x={6} y={4.5} width={4} height={15} rx={1.2} fill="currentColor" stroke="none" />
      <rect x={14} y={4.5} width={4} height={15} rx={1.2} fill="currentColor" stroke="none" />
    </>,
  );

export const IconLoop = ({ size }: IconProps) =>
  svg(
    size,
    <>
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </>,
  );

export const IconVolume = ({ size }: IconProps) =>
  svg(
    size,
    <>
      <path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" stroke="none" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9.5 9.5 0 0 1 0 13" />
    </>,
  );

export const IconMute = ({ size }: IconProps) =>
  svg(
    size,
    <>
      <path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" stroke="none" />
      <line x1={16} y1={9} x2={22} y2={15} />
      <line x1={22} y1={9} x2={16} y2={15} />
    </>,
  );

export const IconSettings = ({ size }: IconProps) =>
  svg(
    size,
    <>
      <line x1={4} y1={6} x2={20} y2={6} />
      <circle cx={9} cy={6} r={2.2} fill="var(--bg-strong, #10121a)" />
      <line x1={4} y1={12} x2={20} y2={12} />
      <circle cx={15} cy={12} r={2.2} fill="var(--bg-strong, #10121a)" />
      <line x1={4} y1={18} x2={20} y2={18} />
      <circle cx={7} cy={18} r={2.2} fill="var(--bg-strong, #10121a)" />
    </>,
  );

export const IconExport = ({ size }: IconProps) =>
  svg(
    size,
    <>
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </>,
  );

export const IconFolder = ({ size }: IconProps) =>
  svg(size, <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />);

export const IconMusic = ({ size }: IconProps) =>
  svg(
    size,
    <>
      <path d="M9 18V5l12-2v13" />
      <circle cx={6} cy={18} r={3} />
      <circle cx={18} cy={16} r={3} />
    </>,
  );

export const IconFullscreen = ({ size }: IconProps) =>
  svg(
    size,
    <>
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M16 3h3a2 2 0 0 1 2 2v3" />
      <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </>,
  );

/** Stacked sheets — a queue of tracks, one video each. */
export const IconBatch = ({ size }: IconProps) =>
  svg(
    size,
    <>
      <path d="M12 3l9 5-9 5-9-5 9-5z" />
      <path d="M3 13l9 5 9-5" />
      <path d="M3 17.5l9 5 9-5" />
    </>,
  );

export const IconChevronLeft = ({ size }: IconProps) => svg(size, <path d="M15 18l-6-6 6-6" />);

export const IconChevronRight = ({ size }: IconProps) => svg(size, <path d="M9 6l6 6-6 6" />);

export const IconClose = ({ size }: IconProps) =>
  svg(
    size,
    <>
      <line x1={6} y1={6} x2={18} y2={18} />
      <line x1={18} y1={6} x2={6} y2={18} />
    </>,
  );

export const IconDrop = ({ size }: IconProps) =>
  svg(
    size,
    <>
      <path d="M12 3v11" />
      <path d="M8 10l4 4 4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </>,
  );

export const IconHelp = ({ size }: IconProps) =>
  svg(
    size,
    <>
      <circle cx={12} cy={12} r={9} />
      <path d="M9.5 9.3a2.6 2.6 0 0 1 5.1.8c0 1.7-2.6 2.2-2.6 3.6" />
      <circle cx={12} cy={17} r={0.4} fill="currentColor" />
    </>,
  );
