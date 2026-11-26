import './fonts.css';

/** Fonts offered in the layout editor, grouped for the picker. Keep in step with fonts.css. */
export const FONT_GROUPS: Array<{ label: string; fonts: string[] }> = [
  {
    label: 'Book serifs',
    fonts: ['EB Garamond', 'Crimson Pro', 'Alegreya', 'Libre Baskerville', 'Lora', 'Spectral', 'Source Serif 4'],
  },
  {
    label: 'Fantasy display',
    fonts: [
      'Cinzel',
      'Cinzel Decorative',
      'IM Fell English',
      'IM Fell English SC',
      'Uncial Antiqua',
      'MedievalSharp',
      'Almendra',
      'Pirata One',
      'Metamorphous',
    ],
  },
  {
    label: 'Modern sans',
    fonts: ['Inter', 'Source Sans 3', 'Montserrat', 'Oswald', 'Bebas Neue', 'Barlow Condensed'],
  },
  { label: 'Typewriter', fonts: ['Special Elite', 'Courier Prime'] },
  {
    // Not bundled: these only work on devices that have them installed.
    label: 'On this computer',
    fonts: ['Georgia', 'Palatino Linotype', 'Times New Roman', 'Arial', 'Verdana', 'Trebuchet MS', 'Courier New'],
  },
];

export const DEFAULT_FONT = 'EB Garamond';
