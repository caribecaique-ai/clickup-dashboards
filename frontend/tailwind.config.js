/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                void: {
                    black: '#000000',
                    surface: '#070707',
                    card: '#0a0a0a',
                    elevated: '#0e0e0e',
                    hover: '#111111',
                },
                neon: {
                    purple: '#b44aff',
                    blue: '#3b82f6',
                    yellow: '#facc15',
                    green: '#22c55e',
                    white: '#e0e0e0',
                },
                text: {
                    voidPrimary: '#d4d4d4',
                    voidSecondary: '#5a5a5a',
                    voidMuted: '#333333',
                }
            },
            fontFamily: {
                sans: ['Sora', 'sans-serif'],
                mono: ['IBM Plex Mono', 'monospace'],
            },
            backgroundImage: {
                'void-border': 'rgba(255, 255, 255, 0.04)',
            },
            boxShadow: {
                'glow-purple': '0 0 20px rgba(180, 74, 255, 0.3), 0 0 60px rgba(180, 74, 255, 0.08)',
                'glow-blue': '0 0 20px rgba(59, 130, 246, 0.3), 0 0 60px rgba(59, 130, 246, 0.08)',
                'glow-yellow': '0 0 20px rgba(250, 204, 21, 0.3), 0 0 60px rgba(250, 204, 21, 0.08)',
                'glow-green': '0 0 20px rgba(34, 197, 94, 0.3), 0 0 60px rgba(34, 197, 94, 0.08)',
            }
        },
    },
    plugins: [],
}
