import type { SVGProps } from 'react';

const PATHS: Record<string, string[]> = {
  sites: ['M4 6.5h6.5V13H4z', 'M13.5 6.5H20V13h-6.5z', 'M4 15h16v5H4z'],
  workspace: [
    'M14.5 5.5a3.5 3.5 0 0 0 4.6 4.6l-8.2 8.2a2.3 2.3 0 0 1-3.3-3.3z',
    'M5.5 5.5l2.6 2.6',
  ],
  profile: ['M12 12a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2Z', 'M5 20c0-3.4 3.1-5.6 7-5.6s7 2.2 7 5.6'],
  reports: ['M5 19V9', 'M12 19V5', 'M19 19v-6', 'M3 19h18'],
  deployment: ['M5 15.5c0-4 2-7.4 7-11 5 3.6 7 7 7 11', 'M9.5 15.5h5', 'M12 19v2'],
  check: ['M5 12.5l4.2 4.2L19 7'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7.5V12l3 2'],
  shield: ['M12 3.5l7 2.6v5.3c0 4.2-2.8 7.4-7 9.1-4.2-1.7-7-4.9-7-9.1V6.1z', 'M9 12l2.2 2.2L15.5 10'],
  download: ['M12 4v10', 'M8 10.5l4 4 4-4', 'M5 19h14'],
  alert: ['M12 4.5 3.5 19h17z', 'M12 9.5v4.2', 'M12 16.4v.1'],
  pin: ['M12 21s6.5-6.1 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 14.9 12 21 12 21Z', 'M12 12.4a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8Z'],
  devices: ['M4 5.5h16v9H4z', 'M9 18.5h6', 'M12 14.5v4'],
  document: ['M7 3.5h7l4 4v13H7z', 'M14 3.5v4h4', 'M9.5 12h6', 'M9.5 15.5h6'],
  arrowRight: ['M5 12h13', 'M13 6.5l5.5 5.5-5.5 5.5'],
  logout: ['M15 5.5H6.5v13H15', 'M12 12h8', 'M17 8.5l3.5 3.5-3.5 3.5'],
  reset: ['M4 5v5h5', 'M20 19v-5h-5', 'M5.2 14a7.5 7.5 0 0 0 12.9 2.6', 'M18.8 10A7.5 7.5 0 0 0 5.9 7.4'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z', 'M16.2 16.2 21 21'],
  pause: ['M9 5.5v13', 'M15 5.5v13'],
  play: ['M8 5.5l10 6.5-10 6.5z'],
  camera: ['M4.5 8.5h3l1.5-2h6l1.5 2h3v10h-15z', 'M12 16.2a3.1 3.1 0 1 0 0-6.2 3.1 3.1 0 0 0 0 6.2Z'],
};

export function Icon({
  name,
  className = 'h-4 w-4',
  ...rest
}: SVGProps<SVGSVGElement> & { name: keyof typeof PATHS | string }) {
  const paths = PATHS[name] ?? PATHS.sites;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      {paths.map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}
