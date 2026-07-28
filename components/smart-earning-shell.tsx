'use client';
import Image from'next/image';
import Link from'next/link';
import{useState}from'react';
import{usePathname}from'next/navigation';
import{ArrowLeft,ChartNoAxesCombined,ChevronRight,GitBranch,History,Home,LogOut,Menu,Sun,Users,Wallet,X}from'lucide-react';

const appNav:[string,string,typeof Home][]=[['/dashboard','Home',Home],['/income','Income',ChartNoAxesCombined],['/matrix','Matrix',GitBranch],['/team','Team',Users],['/wallet','Wallet',Wallet]];
const historyNav:[string,string][]=[
 ['/history','All History'],['/history?category=PACKAGES','Package Purchase History'],
 ['/history?category=PACKAGES','Upgrade History'],['/history?category=BOOSTER','Booster History'],
 ['/history?category=REFERRALS','Direct Referral History'],['/history?category=PACKAGES','Team Package History'],
 ['/history?category=INCOME','Direct Income History'],['/history?category=MATRIX','Matrix Income History'],
 ['/history?category=AUTOPOOL','Autopool History'],['/history?category=MAGIC','Magic Level History'],
 ['/history?category=BOOSTER','Booster Income History'],['/history?category=DIVIDEND','Dividend History'],
 ['/history?category=WITHDRAWALS','Withdrawal History'],['/history?category=WALLET','Wallet Transaction History'],
 ['/history?category=MATRIX','Recycle History'],
];

function SmartLogo(){return <Link href="/dashboard" className="header-logo-crop" aria-label="Smart Earning dashboard"><Image src="/logo.png" alt="Smart Earning" width={1048} height={356} priority className="header-logo-image object-contain"/></Link>}

export function FixedMetaverseBackground(){return <div className="fixed-metaverse-background" aria-hidden><Image src="/images/smart-earning-metaverse-man.png" alt="" fill priority sizes="100vw" draggable={false}/><div className="fixed-metaverse-overlay"/></div>}
export const SmartEarningBackground=FixedMetaverseBackground;

export function SmartEarningHeader({home=false}:{home?:boolean}){const[open,setOpen]=useState(false);async function logout(){try{await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'})}finally{window.location.assign('/login')}}return <><header className="dash-header sticky top-0 z-50 flex h-14 items-center justify-between px-3 sm:px-4 lg:ml-60 lg:px-7"><div className="flex min-w-0 items-center gap-1"><button type="button" aria-label={home?"Open menu":"Go back"} onClick={()=>home?setOpen(true):history.back()} className="dash-icon">{home?<Menu size={19}/>:<ArrowLeft size={18}/>}</button><SmartLogo/></div><div className="flex items-center gap-1">{home&&<button type="button" aria-label="Light theme" className="dash-icon"><Sun size={17}/></button>}<button type="button" aria-label="Log out" onClick={logout} className="dash-icon"><LogOut size={17}/></button></div></header>{home&&open&&<div className="history-drawer-backdrop" onClick={()=>setOpen(false)}><aside className="history-drawer" aria-label="History Center menu" onClick={event=>event.stopPropagation()}><div className="history-drawer-head"><SmartLogo/><button type="button" aria-label="Close menu" onClick={()=>setOpen(false)}><X size={18}/></button><p>HISTORY CENTER</p></div><div className="history-drawer-divider"/><nav>{historyNav.map(([href,label])=><Link href={href} onClick={()=>setOpen(false)} key={label}><History size={16}/><span>{label}</span><ChevronRight size={14}/></Link>)}</nav></aside></div>}</>}

export function SmartEarningBottomNav(){const path=usePathname();return <nav className="dash-bottom fixed inset-x-3 bottom-[max(10px,env(safe-area-inset-bottom))] z-50 flex h-[86px] items-center justify-around rounded-[28px] px-1.5 lg:hidden">{appNav.map(([href,label,I])=>{const active=path===href||path.startsWith(`${href}/`);return <Link href={href} key={label} className={`flex min-w-[58px] flex-col items-center gap-1.5 rounded-[18px] px-2 py-3 text-[10px] font-semibold transition ${active?'bg-[#00F77A]/14 text-[#F5FFF9] shadow-[inset_0_0_0_1px_rgba(0,247,122,.16)]':'text-[#8B9D94]'}`}><I size={active?21:19} className={active?'text-[#00F77A]':''}/>{label}</Link>})}</nav>}

function SmartEarningSidebar(){const path=usePathname();return <aside className="dash-sidebar fixed inset-y-0 left-0 z-50 hidden w-60 p-5 lg:block"><Link href="/dashboard" aria-label="Smart Earning dashboard"><Image src="/logo.png" alt="Smart Earning" width={1048} height={356} priority className="h-auto w-[132px] object-contain"/></Link><p className="mt-12 px-3 text-[10px] tracking-[.22em] text-[#8B9D94]">NAVIGATION</p><div className="mt-3 space-y-2">{appNav.map(([href,label,I])=>{const active=path===href||path.startsWith(`${href}/`);return <Link key={label} href={href} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm ${active?'bg-[#00F77A]/10 text-[#00F77A]':'text-[#8B9D94] hover:text-[#F5FFF9]'}`}><I size={18}/>{label}</Link>})}</div><div className="smart-glass-card absolute bottom-6 left-5 right-5 rounded-2xl p-4 text-xs text-[#8B9D94]">Network<br/><span className="text-[#F5FFF9]">BNB Testnet · Chain 97</span></div></aside>}

export function SmartEarningPageShell({children,home=false}:{children:React.ReactNode;home?:boolean}){return <div className="dashboard-theme smart-internal-shell fixed-background-shell min-h-screen bg-[#020705] text-[#F5FFF9]"><FixedMetaverseBackground/><SmartEarningSidebar/><SmartEarningHeader home={home}/><main className="relative z-[2] mx-auto max-w-[1480px] px-3 pb-[calc(116px+env(safe-area-inset-bottom))] pt-3 sm:px-4 lg:ml-60 lg:px-7 lg:pb-10">{children}</main><SmartEarningBottomNav/></div>}
