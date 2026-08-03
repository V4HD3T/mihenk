/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#F4F5F3',
        surface: '#FFFFFF',
        ink: '#161A22',
        inkmuted: '#5B6270',
        line: '#DEE1E6',
        primary: {
          DEFAULT: '#2B3A67',
          light: '#3E4F84',
          dark: '#1C2748',
        },
        success: {
          DEFAULT: '#1F8A5F',
          bg: '#E7F5EE',
        },
        error: {
          DEFAULT: '#C1443D',
          bg: '#FBEAE9',
        },
        warning: {
          DEFAULT: '#C9862C',
          bg: '#FBF0DF',
        },
      },
      fontFamily: {
        display: ['"Fraunces"', 'serif'],
        body: ['"IBM Plex Sans"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        card: '10px',
      },
    },
  },
  plugins: [],
};
