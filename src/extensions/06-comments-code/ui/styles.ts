/* =========================================================
 * 🏷️ TYPES
 * ========================================================= */
export interface CommentTag {
  text: string;
  type: 'word' | 'line'; // 'word' colors only the match, 'line' colors the rest of the comment
  color?: string;
  backgroundColor?: string;
  strikethrough?: boolean;
  fontWeight?: string; // bold?
  fontStyle?: string; // italic?
  gutterIcon?: 'alert' | 'question' | 'todo' | 'fixme' | 'note' | 'mark';
}

/* =========================================================
 * 🎨 DEFAULT TAGS
 * ========================================================= */
export const defaultTags: CommentTag[] = [
  // Full line highlights
  { text: '!', type: 'line', color: '#4a4f57', fontStyle: 'italic' }, // Alert / Error
  { text: '?', type: 'line', color: '#3297fbff', fontStyle: 'italic', gutterIcon: 'question' }, // Question
  { text: '*', type: 'line', color: '#464646', fontStyle: 'italic' }, // Highlight
  { text: '^', type: 'line', color: '#FFD602', fontStyle: 'italic' }, // Warning
  { text: '#', type: 'line', color: '#ff7a27', fontStyle: 'italic' }, // Section / Header
  { text: '$', type: 'line', color: '#4ae4fc', fontStyle: 'italic' }, // Resource / Value
  { text: '%', type: 'line', color: '#ffffff', fontStyle: 'italic' }, // Ratio / Percent
  { text: '>', type: 'line', color: '#01b887ff', fontStyle: 'italic' }, // Reference / Tag
  { text: '&', type: 'line', color: '#FF4ECD', fontStyle: 'italic' }, // Important
  { text: '~', type: 'line', color: '#aef958ff', fontStyle: 'italic' }, // Deprecated
  { text: '////', type: 'line', color: '#5A5A5A', strikethrough: true }, // Removed

  // Keyword badges
  {
    text: 'TODO:',
    type: 'word',
    color: '#1a1a1a',
    backgroundColor: '#FFD602',
    fontWeight: 'bold',
    gutterIcon: 'todo',
  },
  {
    text: 'FIXME:',
    type: 'word',
    color: '#ffffff',
    backgroundColor: '#ff3366ff',
    fontWeight: 'bold',
    gutterIcon: 'fixme',
  },
  {
    text: 'NOTE:',
    type: 'word',
    color: '#ffffff',
    backgroundColor: '#23D18B',
    fontWeight: 'bold',
    gutterIcon: 'note',
  },
  {
    text: 'MARK:',
    type: 'word',
    color: '#ffffff',
    backgroundColor: '#5A6A85',
    fontWeight: 'bold',
    gutterIcon: 'mark',
  },
];
