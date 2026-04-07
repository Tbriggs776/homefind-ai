/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
  	extend: {
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)',
  			'crandell-md': 'var(--crandell-radius-md)',
  			'crandell-lg': 'var(--crandell-radius-lg)',
  			'crandell-pill': 'var(--crandell-radius-pill)',
  		},
  		colors: {
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			},
  			crandell: {
  				primary: 'var(--crandell-primary)',
  				'primary-hover': 'var(--crandell-primary-hover)',
  				charcoal: 'var(--crandell-charcoal)',
  				'charcoal-hover': 'var(--crandell-charcoal-hover)',
  				surface: 'var(--crandell-surface)',
  				'surface-raised': 'var(--crandell-surface-raised)',
  				'surface-sunken': 'var(--crandell-surface-sunken)',
  				border: 'var(--crandell-border)',
  				text: 'var(--crandell-text)',
  				'text-muted': 'var(--crandell-text-muted)',
  				'status-active': 'var(--crandell-status-active)',
  				'status-pending': 'var(--crandell-status-pending)',
  				'status-featured': 'var(--crandell-status-featured)',
  			},
  		},
  		fontFamily: {
  			sans: ['Roboto', 'ui-sans-serif', 'system-ui', 'sans-serif'],
  		},
  		maxWidth: {
  			crandell: 'var(--crandell-container-max)',
  		},
  		screens: {
  			xl: '1280px',
  			'2xl': '1536px',
  			'3xl': '1792px',
  		},
  		boxShadow: {
  			'crandell-sm': 'var(--crandell-shadow-sm)',
  			'crandell-md': 'var(--crandell-shadow-md)',
  			'crandell-lg': 'var(--crandell-shadow-lg)',
  			'crandell-xl': 'var(--crandell-shadow-xl)',
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
}
