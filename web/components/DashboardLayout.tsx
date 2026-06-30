'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'

interface NavItem {
  label: string
  href: string
}
interface NavSection {
  title: string
  items: NavItem[]
}

const NAV: NavSection[] = [
  {
    title: 'Overview',
    items: [{ label: 'Dashboard', href: '/dashboard' }],
  },
  {
    title: 'Products & BOM',
    items: [
      { label: 'Products', href: '/dashboard/products' },
      { label: 'Component Catalog', href: '/dashboard/components' },
    ],
  },
  {
    title: 'Suppliers & Declarations',
    items: [
      { label: 'Suppliers', href: '/dashboard/suppliers' },
      { label: 'Declarations', href: '/dashboard/declarations' },
      { label: 'Declaration Requests', href: '/dashboard/declaration-requests' },
    ],
  },
  {
    title: 'Compliance',
    items: [
      { label: 'Compliance Engine', href: '/dashboard/compliance' },
      { label: 'SCIP Readiness', href: '/dashboard/scip' },
      { label: 'Declaration Packs', href: '/dashboard/packs' },
    ],
  },
  {
    title: 'Regulatory Lists',
    items: [
      { label: 'RoHS Substances', href: '/dashboard/restricted-substances' },
      { label: 'SVHC Watch', href: '/dashboard/svhc' },
      { label: 'Exemptions', href: '/dashboard/exemptions' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'Tasks', href: '/dashboard/tasks' },
      { label: 'Notifications', href: '/dashboard/notifications' },
      { label: 'Reports', href: '/dashboard/reports' },
      { label: 'Audit Log', href: '/dashboard/audit' },
      { label: 'Search', href: '/dashboard/search' },
    ],
  },
  {
    title: 'Account',
    items: [{ label: 'Settings', href: '/dashboard/settings' }],
  },
]

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(href + '/')
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const s = await authClient.getSession()
      if (cancelled) return
      if (!s?.data?.user) {
        router.push('/auth/sign-in')
        return
      }
      setChecking(false)
    })()
    return () => {
      cancelled = true
    }
  }, [router])

  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  const signOut = async () => {
    await authClient.signOut()
    router.push('/')
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <span className="inline-flex items-center gap-2 text-slate-400">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-lime-400" />
          Loading...
        </span>
      </div>
    )
  }

  const sidebar = (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-5">
      {NAV.map((section) => (
        <div key={section.title}>
          <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
            {section.title}
          </div>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = isActive(pathname, item.href)
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`block rounded-lg px-3 py-2 text-sm transition-colors ${
                      active
                        ? 'bg-lime-500/10 font-medium text-lime-300 ring-1 ring-inset ring-lime-600/30'
                        : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )

  return (
    <div className="flex min-h-screen bg-slate-950">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-slate-800 bg-slate-900/40 lg:block">
        <div className="flex h-16 items-center gap-2 border-b border-slate-800 px-5">
          <span className="h-2.5 w-2.5 rounded-sm bg-lime-400" />
          <Link href="/dashboard" className="text-sm font-bold tracking-tight text-slate-100">
            RohsReachSubstanceDeclarationLedger
          </Link>
        </div>
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/80" onClick={() => setDrawerOpen(false)} aria-hidden />
          <aside className="absolute left-0 top-0 h-full w-72 border-r border-slate-800 bg-slate-900">
            <div className="flex h-16 items-center gap-2 border-b border-slate-800 px-5">
              <span className="h-2.5 w-2.5 rounded-sm bg-lime-400" />
              <span className="text-sm font-bold text-slate-100">RohsReachSubstanceDeclarationLedger</span>
            </div>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-slate-800 bg-slate-900/40 px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setDrawerOpen(true)}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100 lg:hidden"
              aria-label="Open menu"
            >
              ☰
            </button>
            <div className="text-sm text-slate-400">
              <span className="hidden sm:inline">Workspace</span>
              <span className="ml-2 font-medium text-slate-200">Substance Ledger</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/notifications"
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              aria-label="Notifications"
            >
              🔔
            </Link>
            <button
              onClick={signOut}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700"
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="min-w-0 flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
