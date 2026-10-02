import type { ReactElement, SVGProps } from 'react';
import {
  Search,
  House,
  Book,
  Library,
  FileText,
  TextAlignStart,
  StickyNote,
  Sparkles,
  ChartColumn,
  ChartLine,
  ChartScatter,
  UsersRound,
  UserRound,
  SlidersHorizontal,
  CircleHelp,
  Plus,
  Minus,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ChevronLeft,
  ChevronsUpDown,
  Check,
  X,
  Upload,
  Download,
  Link,
  Quote,
  MessageSquare,
  Clock,
  History,
  Calendar,
  Folder,
  Table,
  Grid2X2,
  CodeXml,
  Terminal,
  Play,
  RefreshCw,
  Ellipsis,
  ArrowRight,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Pencil,
  Highlighter,
  Trash2,
  Lock,
  KeyRound,
  ShieldCheck,
  Eye,
  Bell,
  Bold,
  Italic,
  Heading,
  List,
  Undo2,
  Redo2,
  Image,
  Globe,
  ListFilter,
  Star,
  TriangleAlert,
  CircleAlert,
  Info,
  FlaskConical,
  Layers,
  Columns2,
  Bookmark,
  Send,
  Database,
  PanelLeft,
  Mail,
  LogOut,
  Archive,
  Copy,
  ExternalLink,
  Wifi,
  WifiOff,
  MousePointer2,
  type LucideIcon,
} from 'lucide-react';

/** Fixed ResearchHub geometry and semantics; consumers set color through CSS. */
export type IconProps = Omit<
  SVGProps<SVGSVGElement>,
  | 'children'
  | 'width'
  | 'height'
  | 'viewBox'
  | 'fill'
  | 'stroke'
  | 'strokeWidth'
  | 'strokeLinecap'
  | 'strokeLinejoin'
  | 'role'
  | 'aria-label'
  | 'aria-labelledby'
  | 'aria-hidden'
  | 'focusable'
> & {
  readonly size?: 14 | 15 | 16 | 17 | 18 | 19 | 20 | 24;
  /** Omit for decorative icons next to text. Supply a non-empty meaning for standalone images. */
  readonly label?: string;
};

function createIcon(Artwork: LucideIcon) {
  return function ResearchHubIcon({
    size = 16,
    label,
    ...props
  }: IconProps): ReactElement {
    const accessibleLabel = label?.trim();
    return (
      <Artwork
        {...props}
        size={size}
        viewBox="0 0 24 24"
        fill="none"
        color="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        absoluteStrokeWidth={false}
        focusable="false"
        aria-hidden={accessibleLabel ? undefined : true}
        role={accessibleLabel ? 'img' : undefined}
        aria-label={accessibleLabel || undefined}
      />
    );
  };
}

// Explicit imports keep the upstream set out of the public API and bundle.
// Source + ISC / Feather MIT notices: README.md and frontend/THIRD_PARTY_NOTICES.md.
export const SearchIcon = createIcon(Search);
export const HomeIcon = createIcon(House);
export const BookIcon = createIcon(Book);
export const LibraryIcon = createIcon(Library);
export const FileIcon = createIcon(FileText);
export const TextIcon = createIcon(TextAlignStart);
export const NoteIcon = createIcon(StickyNote);
export const SparkleIcon = createIcon(Sparkles);
export const ChartIcon = createIcon(ChartColumn);
export const LineChartIcon = createIcon(ChartLine);
export const ScatterIcon = createIcon(ChartScatter);
export const UsersIcon = createIcon(UsersRound);
export const UserIcon = createIcon(UserRound);
export const SlidersIcon = createIcon(SlidersHorizontal);
export const HelpIcon = createIcon(CircleHelp);
export const PlusIcon = createIcon(Plus);
export const MinusIcon = createIcon(Minus);
export const ChevDownIcon = createIcon(ChevronDown);
export const ChevUpIcon = createIcon(ChevronUp);
export const ChevRightIcon = createIcon(ChevronRight);
export const ChevLeftIcon = createIcon(ChevronLeft);
export const SortIcon = createIcon(ChevronsUpDown);
export const CheckIcon = createIcon(Check);
export const XIcon = createIcon(X);
export const UploadIcon = createIcon(Upload);
export const DownloadIcon = createIcon(Download);
export const LinkIcon = createIcon(Link);
export const QuoteIcon = createIcon(Quote);
export const CommentIcon = createIcon(MessageSquare);
export const ClockIcon = createIcon(Clock);
export const HistoryIcon = createIcon(History);
export const CalendarIcon = createIcon(Calendar);
export const FolderIcon = createIcon(Folder);
export const TableIcon = createIcon(Table);
export const GridIcon = createIcon(Grid2X2);
export const CodeIcon = createIcon(CodeXml);
export const TerminalIcon = createIcon(Terminal);
export const PlayIcon = createIcon(Play);
export const RefreshIcon = createIcon(RefreshCw);
export const MoreIcon = createIcon(Ellipsis);
export const ArrowRightIcon = createIcon(ArrowRight);
export const ArrowLeftIcon = createIcon(ArrowLeft);
export const ArrowUpIcon = createIcon(ArrowUp);
export const ArrowDownIcon = createIcon(ArrowDown);
export const PencilIcon = createIcon(Pencil);
export const HighlightIcon = createIcon(Highlighter);
export const TrashIcon = createIcon(Trash2);
export const LockIcon = createIcon(Lock);
export const KeyIcon = createIcon(KeyRound);
export const ShieldIcon = createIcon(ShieldCheck);
export const EyeIcon = createIcon(Eye);
export const BellIcon = createIcon(Bell);
export const BoldIcon = createIcon(Bold);
export const ItalicIcon = createIcon(Italic);
export const HeadingIcon = createIcon(Heading);
export const ListIcon = createIcon(List);
export const UndoIcon = createIcon(Undo2);
export const RedoIcon = createIcon(Redo2);
export const ImageIcon = createIcon(Image);
export const GlobeIcon = createIcon(Globe);
export const FilterIcon = createIcon(ListFilter);
export const StarIcon = createIcon(Star);
export const WarnIcon = createIcon(TriangleAlert);
export const AlertIcon = createIcon(CircleAlert);
export const InfoIcon = createIcon(Info);
export const FlaskIcon = createIcon(FlaskConical);
export const LayersIcon = createIcon(Layers);
export const ColumnsIcon = createIcon(Columns2);
export const BookmarkIcon = createIcon(Bookmark);
export const SendIcon = createIcon(Send);
export const DatabaseIcon = createIcon(Database);
export const PanelIcon = createIcon(PanelLeft);
export const MailIcon = createIcon(Mail);
export const LogoutIcon = createIcon(LogOut);
export const ArchiveIcon = createIcon(Archive);
export const CopyIcon = createIcon(Copy);
export const ExternalIcon = createIcon(ExternalLink);
export const WifiIcon = createIcon(Wifi);
export const WifiOffIcon = createIcon(WifiOff);
export const CursorIcon = createIcon(MousePointer2);

/** Exactly the 80 design names from Reusable_parts.pdf p.3, in source order. */
export const iconRegistry = {
  search: SearchIcon,
  home: HomeIcon,
  book: BookIcon,
  library: LibraryIcon,
  file: FileIcon,
  text: TextIcon,
  note: NoteIcon,
  sparkle: SparkleIcon,
  chart: ChartIcon,
  lineChart: LineChartIcon,
  scatter: ScatterIcon,
  users: UsersIcon,
  user: UserIcon,
  sliders: SlidersIcon,
  help: HelpIcon,
  plus: PlusIcon,
  minus: MinusIcon,
  chevDown: ChevDownIcon,
  chevUp: ChevUpIcon,
  chevRight: ChevRightIcon,
  chevLeft: ChevLeftIcon,
  sort: SortIcon,
  check: CheckIcon,
  x: XIcon,
  upload: UploadIcon,
  download: DownloadIcon,
  link: LinkIcon,
  quote: QuoteIcon,
  comment: CommentIcon,
  clock: ClockIcon,
  history: HistoryIcon,
  calendar: CalendarIcon,
  folder: FolderIcon,
  table: TableIcon,
  grid: GridIcon,
  code: CodeIcon,
  terminal: TerminalIcon,
  play: PlayIcon,
  refresh: RefreshIcon,
  more: MoreIcon,
  arrowRight: ArrowRightIcon,
  arrowLeft: ArrowLeftIcon,
  arrowUp: ArrowUpIcon,
  arrowDown: ArrowDownIcon,
  pencil: PencilIcon,
  highlight: HighlightIcon,
  trash: TrashIcon,
  lock: LockIcon,
  key: KeyIcon,
  shield: ShieldIcon,
  eye: EyeIcon,
  bell: BellIcon,
  bold: BoldIcon,
  italic: ItalicIcon,
  heading: HeadingIcon,
  list: ListIcon,
  undo: UndoIcon,
  redo: RedoIcon,
  image: ImageIcon,
  globe: GlobeIcon,
  filter: FilterIcon,
  star: StarIcon,
  warn: WarnIcon,
  alert: AlertIcon,
  info: InfoIcon,
  flask: FlaskIcon,
  layers: LayersIcon,
  columns: ColumnsIcon,
  bookmark: BookmarkIcon,
  send: SendIcon,
  database: DatabaseIcon,
  panel: PanelIcon,
  mail: MailIcon,
  logout: LogoutIcon,
  archive: ArchiveIcon,
  copy: CopyIcon,
  external: ExternalIcon,
  wifi: WifiIcon,
  wifiOff: WifiOffIcon,
  cursor: CursorIcon,
} as const;

export type IconName = keyof typeof iconRegistry;
export const iconNames = Object.keys(iconRegistry) as readonly IconName[];

export function Icon({
  name,
  ...props
}: IconProps & { readonly name: IconName }): ReactElement {
  const Component = iconRegistry[name];
  return <Component {...props} />;
}
