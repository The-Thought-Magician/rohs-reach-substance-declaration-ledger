import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'RohsReachSubstanceDeclarationLedger',
  description: 'A substances ledger that proves every product is RoHS and REACH compliant, from the legal substance list down to the homogeneous material.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 min-h-screen antialiased">{children}</body>
    </html>
  )
}
