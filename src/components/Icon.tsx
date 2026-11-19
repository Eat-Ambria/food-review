// Gives every icon in the app by name (Lucide icons, no emoji).
import type { SVGProps } from 'react'
import {
  AlertTriangle, ArrowLeft, Bell, Calendar, CalendarCheck2, Check, ChevronDown, ChevronRight, CircleCheck,
  Clock, Download, FileAudio, FileText, Inbox, KeyRound, LayoutDashboard, LayoutGrid, Layers, List,
  Lock, LockOpen, LogOut, MapPin, Mic, Moon, Pause, Pencil, Play, Plus, RefreshCw, Search, ShieldAlert,
  Square, Sun, Sunset, Trash2, Upload, User, Users, Volume2, WifiOff, X, Sparkles, MoreHorizontal,
  Utensils, Tag, Filter, Menu,
  type LucideIcon,
} from 'lucide-react'

const ICONS = {
  mic: Mic,
  list: List,
  inbox: Inbox,
  grid: LayoutGrid,
  dashboard: LayoutDashboard,
  layers: Layers,
  submissions: FileAudio,
  calendar: Calendar,
  calendarCheck: CalendarCheck2,
  user: User,
  users: Users,
  logout: LogOut,
  key: KeyRound,
  lock: Lock,
  unlock: LockOpen,
  alert: AlertTriangle,
  shieldAlert: ShieldAlert,
  wifiOff: WifiOff,
  check: Check,
  checkCircle: CircleCheck,
  plus: Plus,
  x: X,
  upload: Upload,
  download: Download,
  search: Search,
  pencil: Pencil,
  refresh: RefreshCw,
  file: FileText,
  arrowLeft: ArrowLeft,
  stop: Square,
  play: Play,
  pause: Pause,
  trash: Trash2,
  sun: Sun,
  sunset: Sunset,
  moon: Moon,
  volume: Volume2,
  bell: Bell,
  chevron: ChevronDown,
  chevronRight: ChevronRight,
  clock: Clock,
  pin: MapPin,
  sparkles: Sparkles,
  more: MoreHorizontal,
  utensils: Utensils,
  tag: Tag,
  filter: Filter,
  menu: Menu,
} satisfies Record<string, LucideIcon>

export type IconName = keyof typeof ICONS

export function Icon({ name, strokeWidth = 1.9, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  const Cmp = ICONS[name]
  return <Cmp aria-hidden="true" strokeWidth={strokeWidth} {...(props as object)} />
}
