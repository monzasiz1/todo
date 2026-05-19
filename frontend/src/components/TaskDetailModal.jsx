import { motion, AnimatePresence } from 'framer-motion';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTaskStore } from '../store/taskStore';
import { useGroupStore } from '../store/groupStore';
import { useNotesStore } from '../store/notesStore';
import NoteEditorModal from './NoteEditorModal';
import { lockScroll, unlockScroll } from '../utils/scrollLock';
import { api } from '../utils/api';
import {
  X, ArrowLeft, Calendar, CalendarCheck, Clock, Tag, Flag, CheckCircle2, Circle,
  Trash2, AlertTriangle, Repeat, Bell, FileText, ListChecks,
  Users, UserCheck, Eye, Edit3, Share2, MoreVertical, MessageCircle, Send, Video, ThumbsUp, ThumbsDown,
  Lock, ChevronDown, Settings2, MapPin, ExternalLink, StickyNote, Link2, Link2Off, Search
} from 'lucide-react';
import { format, parseISO, isToday, isTomorrow, isPast } from 'date-fns';
import { de } from 'date-fns/locale';
// TaskEditModal nur on-demand: oeffnet sich erst per Edit-Klick.
const TaskEditModal = lazy(() => import('./TaskEditModal'));
const ShareTaskSheet = lazy(() => import('./ShareTaskSheet'));
import TaskAttachments from './TaskAttachments';
import AvatarBadge from './AvatarBadge';
import DeleteTaskChoiceModal from './DeleteTaskChoiceModal';

const priorityConfig = {
  low: { label: 'Niedrig', color: 'var(--success)', icon: Flag },
  medium: { label: 'Mittel', color: 'var(--primary)', icon: Flag },
  high: { label: 'Hoch', color: 'var(--warning)', icon: Flag },
  urgent: { label: 'Dringend', color: 'var(--danger)', icon: AlertTriangle },
};

// ── Drum / Wheel Picker ────────────────────────────────────────
const DRUM_H = 44;
const HOUR_ITEMS = Array.from({ length: 24 }, (_, i) => { const s = String(i).padStart(2, '0'); return { value: s, label: s }; });
const MINUTE_ITEMS = Array.from({ length: 12 }, (_, i) => { const s = String(i * 5).padStart(2, '0'); return { value: s, label: s }; });

function WheelCol({ items, initialValue, onChange }) {
  const ref = useRef(null);
  const timerRef = useRef(null);
  const [selIdx, setSelIdx] = useState(() => Math.max(0, items.findIndex((it) => it.value === initialValue)));
  useEffect(() => { if (ref.current) ref.current.scrollTop = selIdx * DRUM_H; }, []); // eslint-disable-line
  const onScroll = () => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (!ref.current) return;
      const idx = Math.round(ref.current.scrollTop / DRUM_H);
      const c = Math.max(0, Math.min(idx, items.length - 1));
      setSelIdx(c);
      onChange(items[c].value);
    }, 100);
  };
  return (
    <div className="drum-col-wrap">
      <div className="drum-col" ref={ref} onScroll={onScroll}>
        <div className="drum-spacer" />
        {items.map((it, i) => (
          <div key={it.value} className={`drum-item${i === selIdx ? ' sel' : ''}`}>{it.label}</div>
        ))}
        <div className="drum-spacer" />
      </div>
      <div className="drum-fade-t" />
      <div className="drum-fade-b" />
      <div className="drum-sel-stripe" />
    </div>
  );
}
// ────────────────────────────────────────────────────────────────

// pageMode=true → renders as a scrollable page (mobile/tablet)
// pageMode=false (default) → renders as a modal popup (desktop)
export default function TaskDetailModal({ task, onClose, onUpdated, pageMode = false, hidePrivateShareInfo = false }) {
  const toggleTask = useTaskStore((s) => s.toggleTask);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const addToast = useTaskStore((s) => s.addToast);
  const notesAll = useNotesStore((s) => s.notes);
  const updateNoteStore = useNotesStore((s) => s.updateNote);
  const deleteNoteStore = useNotesStore((s) => s.deleteNote);
  const completeNoteStore = useNotesStore((s) => s.completeNote);
  const fetchNotesStore = useNotesStore((s) => s.fetchNotes);
  const navigate = useNavigate();
  const [notePickerOpen, setNotePickerOpen] = useState(false);
  const [notePickerQuery, setNotePickerQuery] = useState('');
  const [openNoteId, setOpenNoteId] = useState(null);
  const [friends, setFriends] = useState([]);
  const [freshSender, setFreshSender] = useState(null); // cached-Task-unabhängige Sender-Daten
  const [showEdit, setShowEdit] = useState(false);
  const [showSharePanel, setShowSharePanel] = useState(false);
  const [shareVisibility, setShareVisibility] = useState('private');
  const [sharePermissions, setSharePermissions] = useState([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareSaving, setShareSaving] = useState(false);
  const [showSubgroupList, setShowSubgroupList] = useState(false);
  const [groupSubgroups, setGroupSubgroups] = useState([]);
  const [showSubgroupPicker, setShowSubgroupPicker] = useState(false);
  const [subgroupSaving, setSubgroupSaving] = useState(false);
  const [showDateTimeEdit, setShowDateTimeEdit] = useState(false);
  const [dtDate, setDtDate] = useState('');
  const [dtHour, setDtHour] = useState('12');
  const [dtMinute, setDtMinute] = useState('00');
  const [dtEndHour, setDtEndHour] = useState('13');
  const [dtEndMinute, setDtEndMinute] = useState('00');
  const [dtEndEnabled, setDtEndEnabled] = useState(false);
  const [dtDateEnd, setDtDateEnd] = useState('');
  const [dtEndDateEnabled, setDtEndDateEnabled] = useState(false);
  const [dtSaving, setDtSaving] = useState(false);
  const [sharingToChat, setSharingToChat] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const [showMapChoice, setShowMapChoice] = useState(false);
  const [mapChoicePos, setMapChoicePos] = useState(null);
  const mapBtnRef = useRef(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState([]);
  const [taskVotes, setTaskVotes] = useState({ yes_count: 0, no_count: 0, yes_users: [], no_users: [], unanswered_users: [], my_vote: null, member_count: null, unanswered_count: null });
  const [voting, setVoting] = useState(false);
  const [votesOpen, setVotesOpen] = useState(null);
  const menuRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const swipeRef = useRef({ startY: 0, active: false });
  const pullRafRef = useRef(null);
  const pullNextRef = useRef(0);
  const pullOffsetRef = useRef(0);
  const [pullOffset, setPullOffset] = useState(0);
  const titleRef = useRef(null);
  const stickyTopRef = useRef(null);
  const [titleHidden, setTitleHidden] = useState(false);
  const [scrollDarkened, setScrollDarkened] = useState(false);
  const [pullHandleHidden, setPullHandleHidden] = useState(false);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1024px)').matches
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1024px)');
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const currentUser = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
  }, []);
  const currentUserId = currentUser?.id != null ? String(currentUser.id) : '';
  const isOwnerResolved = useMemo(() => {
    const ownerId = Number(task?.user_id);
    const selfId = Number(currentUser?.id);
    if (Number.isFinite(ownerId) && Number.isFinite(selfId)) {
      return ownerId === selfId;
    }
    return task?.is_owner === true;
  }, [task?.user_id, task?.is_owner, currentUser?.id]);
  const blockedShareUserIds = useMemo(() => {
    const set = new Set();
    const ownerId = Number(task?.user_id);
    const selfId = Number(currentUser?.id);
    if (Number.isFinite(ownerId)) set.add(ownerId);
    if (Number.isFinite(selfId)) set.add(selfId);
    return set;
  }, [task?.user_id, currentUser?.id]);

  const groupsFromStore = useGroupStore((s) => s.groups);
  const isGroupAdminTask = useMemo(() => {
    if (isOwnerResolved || !task?.group_id) return false;
    if (task?.my_group_role === 'owner' || task?.my_group_role === 'admin') return true;
    const grp = (groupsFromStore || []).find((g) => String(g.id) === String(task.group_id));
    return grp?.role === 'owner' || grp?.role === 'admin';
  }, [isOwnerResolved, task?.group_id, task?.my_group_role, groupsFromStore]);

  const [deleteChoiceOpen, setDeleteChoiceOpen] = useState(false);

  // Swipe down to close on mobile
  const queuePullOffset = (next) => {
    pullNextRef.current = next;
    if (pullRafRef.current !== null) return;
    pullRafRef.current = window.requestAnimationFrame(() => {
      pullRafRef.current = null;
      setPullOffset((prev) => (prev === pullNextRef.current ? prev : pullNextRef.current));
    });
  };

  const handleTouchStart = (e) => {
    if (!isMobile) return;
    swipeRef.current = { startY: e.touches[0].clientY, active: true };
  };
  const handleTouchMove = (e) => {
    if (!isMobile || !swipeRef.current.active) return;
    const dy = e.touches[0].clientY - swipeRef.current.startY;

    // Only pull down when content is already at top.
    if (dy <= 0 || e.currentTarget.scrollTop > 0) {
      if (pullOffsetRef.current !== 0) {
        pullOffsetRef.current = 0;
        queuePullOffset(0);
      }
      return;
    }

    // Prevent iOS rubber-band/background scroll and move modal itself instead.
    if (e.cancelable) e.preventDefault();
    const maxPull = Math.max(420, (typeof window !== 'undefined' ? window.innerHeight : 800) - 28);
    const resisted = Math.min(dy * 0.95, maxPull);
    pullOffsetRef.current = resisted;
    queuePullOffset(resisted);
  };
  const handleTouchEnd = (e) => {
    if (!isMobile || !swipeRef.current.active) return;
    const dy = e.changedTouches[0].clientY - swipeRef.current.startY;
    swipeRef.current.active = false;
    const shouldClose = dy > 130 && e.currentTarget.scrollTop <= 0;
    pullOffsetRef.current = 0;
    queuePullOffset(0);
    // Down swipe: close and return to underlying previous view.
    if (shouldClose) { onClose(); return; }
  };

  useEffect(() => {
    return () => {
      if (pullRafRef.current !== null) {
        window.cancelAnimationFrame(pullRafRef.current);
      }
    };
  }, []);

  // Notes beim Oeffnen der Task neu laden. Wichtig: auch wenn der Store
  // bereits eigene Notes enthaelt, koennen Team-Notes von anderen Usern (zu
  // dieser Task) erst nach einem fetch sichtbar werden.
  useEffect(() => {
    if (!task?.id) return;
    try { fetchNotesStore?.(); } catch {}
    // Nur beim Oeffnen pruefen – kein Loop wenn notesAll sich aendert
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  useEffect(() => {
    if (!isMobile || pageMode) return;
    const stopBackgroundTouchWhilePulling = (e) => {
      if (pullOffsetRef.current > 0 && e.cancelable) {
        e.preventDefault();
      }
    };
    document.addEventListener('touchmove', stopBackgroundTouchWhilePulling, { passive: false });
    return () => document.removeEventListener('touchmove', stopBackgroundTouchWhilePulling);
  }, [isMobile, pageMode]);

  useEffect(() => {
    // Lock background scroll while modal is open (desktop + mobile overlay mode)
    // pageMode stays unlocked because it is rendered as normal page content.
    if (pageMode) return;
    lockScroll();
    return () => unlockScroll();
  }, [pageMode]);

  useEffect(() => {
    const titleEl = titleRef.current;
    const stickyEl = stickyTopRef.current;
    if (!titleEl || !stickyEl) return;
    const check = () => {
      const titleRect = titleEl.getBoundingClientRect();
      const stickyRect = stickyEl.getBoundingClientRect();
      const scrolled = titleRect.top < stickyRect.bottom;
      // Show sticky title only when the full title row is behind the header
      setTitleHidden(titleRect.bottom < stickyRect.bottom);
      setScrollDarkened(scrolled);
      setPullHandleHidden(scrolled);
    };
    const scrollEl =
      titleEl.closest('.is-mobile-fullscreen') ||
      titleEl.closest('.task-detail-main') ||
      titleEl.closest('.task-detail-modal');
    scrollEl?.addEventListener('scroll', check, { passive: true });
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check, { passive: true });
    check();
    return () => {
      scrollEl?.removeEventListener('scroll', check);
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, [isMobile]);

  // Für weitergeleitete Tasks: Sender direkt vom Server laden (ohne localStorage-Cache-Flackern)
  useEffect(() => {
    if (!task?.id) return;
    const ownerId = Number(task?.user_id);
    const selfId = Number(currentUser?.id);
    const isForwarded = Number.isFinite(ownerId) && Number.isFinite(selfId) && ownerId !== selfId
      && task?.visibility === 'selected_users';
    if (!isForwarded) { setFreshSender(null); return; }
    let mounted = true;
    api.getTask(task.id)
      .then((data) => {
        const t = data?.task || data;
        if (mounted && t?.creator_name) {
          setFreshSender({
            name: t.creator_name,
            color: t.creator_color || '#007AFF',
            avatar_url: t.creator_avatar_url || null,
          });
        }
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, [task?.id, task?.user_id, task?.visibility, currentUser?.id]);

  useEffect(() => {
    if (!showSharePanel) return;
    let mounted = true;
    setShareLoading(true);
    api.getFriends()
      .then((data) => { if (mounted) setFriends(Array.isArray(data) ? data : (data?.friends || [])); })
      .catch(() => {});
    api.getPermissions(task.id)
      .then((data) => {
        if (!mounted) return;
        setShareVisibility(data.visibility || 'private');
        setSharePermissions(
          (data.permissions || []).map((p) => ({
            user_id: p.user_id,
            can_view: p.can_view,
            can_edit: p.can_edit,
            name: p.user_name,
            avatar_color: p.avatar_color,
            avatar_url: p.avatar_url,
          })).filter((p) => {
            const id = Number(p.user_id);
            return Number.isFinite(id) && !blockedShareUserIds.has(id);
          })
        );
      })
      .catch(() => {})
      .finally(() => { if (mounted) setShareLoading(false); });
    return () => { mounted = false; };
  }, [showSharePanel, task.id, blockedShareUserIds]);

  useEffect(() => {
    const hasGroupAdminRole = task?.my_group_role === 'owner' || task?.my_group_role === 'admin';
    if (!hasGroupAdminRole || !task?.group_id) return;
    api.getGroupSubgroups(task.group_id)
      .then((data) => setGroupSubgroups(Array.isArray(data) ? data : (data?.subgroups || [])))
      .catch(() => {});
  }, [task?.group_id, task?.my_group_role]);

  const handleSubgroupChange = async (subgroupId) => {
    setSubgroupSaving(true);
    try {
      await api.updateGroupTask(task.group_id, task.id, { subgroup_id: subgroupId });
      addToast('Untergruppe aktualisiert', 'success');
      if (onUpdated) onUpdated();
      setShowSubgroupPicker(false);
    } catch {
      addToast('Fehler beim Speichern', 'error');
    }
    setSubgroupSaving(false);
  };

  const dateItems = useMemo(() => {
    const base = new Date(); base.setHours(0, 0, 0, 0);
    return Array.from({ length: 426 }, (_, i) => {
      const d = i - 60;
      const date = new Date(base.getTime() + d * 86_400_000);
      const val = format(date, 'yyyy-MM-dd');
      const label = d === 0 ? 'Heute' : d === 1 ? 'Morgen' : d === -1 ? 'Gestern'
        : format(date, 'EEE, d. MMM', { locale: de });
      return { value: val, label };
    });
  }, []);

  const openDateTimeEdit = () => {
    const startStr = task.date ? String(task.date).slice(0, 10) : format(new Date(), 'yyyy-MM-dd');
    const endStr = task.date_end ? String(task.date_end).slice(0, 10) : '';
    setDtDate(startStr);
    setDtDateEnd(endStr && endStr !== startStr ? endStr : startStr);
    setDtEndDateEnabled(!!endStr && endStr !== startStr);
    const t = task.time ? String(task.time).slice(0, 5) : '';
    const te = task.time_end ? String(task.time_end).slice(0, 5) : '';
    setDtHour(t ? t.split(':')[0] : '12');
    setDtMinute(t ? t.split(':')[1] : '00');
    setDtEndHour(te ? te.split(':')[0] : '13');
    setDtEndMinute(te ? te.split(':')[1] : '00');
    setDtEndEnabled(!!task.time_end);
    setShowDateTimeEdit(true);
  };

  const handleSaveDateTime = async () => {
    setDtSaving(true);
    try {
      // Sicherstellen, dass Enddatum nie vor Startdatum liegt
      const safeDateEnd = dtEndDateEnabled && dtDateEnd && dtDate && dtDateEnd >= dtDate
        ? dtDateEnd
        : null;
      const updates = {
        date: dtDate || null,
        date_end: safeDateEnd,
        time: dtHour ? `${dtHour}:${dtMinute}` : null,
        time_end: dtEndEnabled ? `${dtEndHour}:${dtEndMinute}` : null,
      };
      const { updateTask } = useTaskStore.getState();
      await updateTask(task.id, updates);
      addToast('Gespeichert', 'success');
      if (onUpdated) onUpdated();
      setShowDateTimeEdit(false);
    } catch {
      addToast('Fehler beim Speichern', 'error');
    }
    setDtSaving(false);
  };

  const handleSaveShare = async () => {
    setShareSaving(true);
    try {
      const delegatedEditor = !isOwnerResolved && canEdit;
      const nextVisibility = delegatedEditor ? 'selected_users' : shareVisibility;
      const sanitizedPermissions = sharePermissions
        .filter((p) => {
          const id = Number(p.user_id);
          return Number.isFinite(id) && !blockedShareUserIds.has(id);
        })
        .map((p) => ({ user_id: p.user_id, can_view: p.can_view, can_edit: p.can_edit }));
      await api.setPermissions(task.id, {
        visibility: nextVisibility,
        permissions: nextVisibility === 'selected_users'
          ? sanitizedPermissions
          : [],
      });
      addToast('Freigabe gespeichert', 'success');
      if (onUpdated) onUpdated();
    } catch {
      addToast('Fehler beim Speichern', 'error');
    }
    setShareSaving(false);
  };

  const shareTargetFriends = useMemo(
    () => friends.filter((f) => {
      const id = Number(f.friend_user_id);
      return Number.isFinite(id) && !blockedShareUserIds.has(id) && f.status === 'accepted';
    }),
    [friends, blockedShareUserIds]
  );

  const formatDate = (dateStr) => {
    if (!dateStr) return null;
    const date = parseISO(dateStr);
    if (isToday(date)) return 'Heute';
    if (isTomorrow(date)) return 'Morgen';
    return format(date, 'EEEE, d. MMMM yyyy', { locale: de });
  };

  const formatTime = (timeStr) => {
    if (!timeStr) return null;
    const [h, m] = timeStr.split(':');
    return `${h}:${m} Uhr`;
  };

  const getEventEndDate = (t) => {
    if (!t?.date) return null;
    // Bei mehrtaegigen Eintraegen zaehlt das Enddatum (date_end), nicht der
    // erste Tag - sonst gilt das Event schon nach Tag 1 als beendet.
    const datePart = String(t.date_end || t.date).slice(0, 10);
    const rawEnd = String(t.time_end || t.time || '23:59').slice(0, 5);
    const parts = rawEnd.split(':');
    const hh = String(Math.min(23, Math.max(0, Number(parts[0]) || 23))).padStart(2, '0');
    const mm = String(Math.min(59, Math.max(0, Number(parts[1]) || 59))).padStart(2, '0');
    const end = new Date(`${datePart}T${hh}:${mm}:00`);
    return Number.isNaN(end.getTime()) ? null : end;
  };

  // Bei mehrtaegigen Tasks zaehlt das Enddatum: solange heute im Bereich
  // [date, date_end] liegt, ist die Aufgabe nicht ueberfaellig.
  const overdueRef = task?.date_end || task?.date;
  const isOverdue = task?.date && !task?.completed && !!overdueRef
    && isPast(parseISO(overdueRef)) && !isToday(parseISO(overdueRef));
  const priority = priorityConfig[task?.priority] || priorityConfig.medium;
  const PriorityIcon = priority.icon;
  // is_group_member: true = echtes Gruppenmitglied, false = extern per Permission geteilt
  // undefined + my_group_role gesetzt → alter Cache-Task, User ist Mitglied
  // undefined + my_group_role fehlt → geteilter Task, User ist KEIN Mitglied
  const isGroupMember = task?.group_id
    ? (task?.is_group_member === true ||
       (task?.is_group_member === undefined && task?.my_group_role != null))
    : false;
  // Nur Owner/Admin der Gruppe dürfen Berechtigungen verteilen
  const isGroupAdmin = task?.my_group_role === 'owner' || task?.my_group_role === 'admin';
  const canEdit = !isOwnerResolved
    ? (task?.can_edit === true || (!!task?.group_id && isGroupMember))
    : true;
  const isExternallySharedTask = !isOwnerResolved && (!task?.group_id || !isGroupMember);
  const isDirectShareToMe = !isOwnerResolved
    && task?.visibility === 'selected_users'
    && task?.can_see_private_share_info === true
    && !isGroupMember  // Ich bin kein Gruppenmitglied
    && !task?.group_task_creator_name;  // Es ist KEINE (geteilte) Gruppenaufgabe
  const isGroupContextTask = !!task?.group_id && isGroupMember;
  const canManageShare = isOwnerResolved
    || (!!task?.group_id && isGroupAdmin)
    || ((isExternallySharedTask || isDirectShareToMe) && canEdit);
  // Gruppenaufgaben mit externen Nutzern teilen: nur Lesen erlaubt
  const isGroupTaskSharingExternally = task?.group_id && (isOwnerResolved || isGroupMember);
  // canShare: bei Gruppenaufgaben nur Owner/Admin; persönliche Tasks → canEdit
  const canShare = task?.group_id ? isGroupAdmin : canEdit;
  const isShared = task?.visibility && task.visibility !== 'private';
  const canSeePrivateShareInfo = task?.visibility !== 'selected_users' || task?.can_see_private_share_info === true;
  const showPrivateShareSection = isShared && !hidePrivateShareInfo && canSeePrivateShareInfo;
  const shareRowVisibility = showSharePanel ? shareVisibility : (task?.visibility || shareVisibility || 'private');
  const shareRowUsers = showSharePanel
    ? sharePermissions
    : (Array.isArray(task?.shared_with_users)
        ? task.shared_with_users.map((u, index) => ({
            user_id: u.user_id || u.id || `${task?.id || 'task'}_${index}`,
            name: u.name,
            avatar_color: u.avatar_color || u.color,
            avatar_url: u.avatar_url,
          }))
        : []);
  const shareRowLabel = isGroupContextTask && shareRowVisibility === 'private'
    ? 'In der Gruppe'
    : shareRowVisibility === 'shared'
    ? 'Alle Freunde'
    : shareRowVisibility === 'selected_users'
      ? (!isOwnerResolved
          ? 'Mit dir geteilt'
          : (shareRowUsers.length > 0 ? `Mit ${shareRowUsers.length} Person${shareRowUsers.length === 1 ? '' : 'en'}` : 'Auswahl'))
      : 'Nur ich';
  const isEvent = task?.type === 'event';
  const groupWatermarkUrl = task?.group_image_url || task?.group_avatar_url || task?.group_photo_url || task?.group_logo_url || null;
  const hasGroupWatermark = Boolean(groupWatermarkUrl && (isOwnerResolved || isGroupMember));
  const eventEndAt = isEvent ? getEventEndDate(task) : null;
  const isEventEnded = isEvent && !!eventEndAt && eventEndAt.getTime() < Date.now();
  const voteYesCount = Number(taskVotes.yes_count || 0);
  const voteNoCount = Number(taskVotes.no_count || 0);
  const votePendingCount = Number.isFinite(Number(taskVotes?.unanswered_count))
    ? Math.max(0, Number(taskVotes.unanswered_count))
    : (Number.isFinite(Number(task?.vote_unanswered_count)) ? Math.max(0, Number(task.vote_unanswered_count)) : null);
  const voteNeedsAction = taskVotes.my_vote !== 'yes' && taskVotes.my_vote !== 'no';

  useEffect(() => {
    if (!task?.id) { setComments([]); return; }
    api.getComments(task.id)
      .then((res) => { if (res.comments && Array.isArray(res.comments)) setComments(res.comments); })
      .catch(() => setComments([]));
  }, [task?.id]);

  useEffect(() => {
    if (!task?.id || task?.enable_group_rsvp !== true) {
      setTaskVotes({ yes_count: 0, no_count: 0, yes_users: [], no_users: [], unanswered_users: [], my_vote: null, member_count: null, unanswered_count: null });
      setVotesOpen(null);
      return;
    }
    api.getTaskVotes(task.id)
      .then((res) => {
        setTaskVotes({
          yes_count: Number(res?.yes_count || 0),
          no_count: Number(res?.no_count || 0),
          yes_users: Array.isArray(res?.yes_users) ? res.yes_users : [],
          no_users: Array.isArray(res?.no_users) ? res.no_users : [],
          unanswered_users: Array.isArray(res?.unanswered_users) ? res.unanswered_users : [],
          my_vote: res?.my_vote || null,
          member_count: Number.isFinite(Number(res?.member_count)) ? Number(res.member_count) : null,
          unanswered_count: Number.isFinite(Number(res?.unanswered_count)) ? Number(res.unanswered_count) : null,
        });
      })
      .catch(() => {
        setTaskVotes({ yes_count: 0, no_count: 0, yes_users: [], no_users: [], unanswered_users: [], my_vote: null, member_count: null, unanswered_count: null });
      });
  }, [task?.id, task?.enable_group_rsvp]);

  useEffect(() => {
    setShareVisibility(task?.visibility || 'private');
    setSharePermissions(
      Array.isArray(task?.shared_with_users)
        ? task.shared_with_users.map((u, index) => ({
            user_id: u.user_id || u.id || `${task?.id || 'task'}_${index}`,
            can_view: true,
            can_edit: false,
            name: u.name,
            avatar_color: u.avatar_color || u.color,
            avatar_url: u.avatar_url,
          })).filter((p) => {
            const id = Number(p.user_id);
            return Number.isFinite(id) && !blockedShareUserIds.has(id);
          })
        : []
    );
  }, [task?.id, task?.visibility, task?.shared_with_users, blockedShareUserIds]);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (menuRef.current?.contains(e.target)) return;
      if (emojiPickerRef.current?.contains(e.target)) return;
      setShowMenu(false);
      setShowShareMenu(false);
      setShowEmojiPicker(false);
    };
    if (showMenu || showEmojiPicker) document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [showMenu, showEmojiPicker]);

  if (!task) return null;

  const handleToggle = async () => {
    const updated = await toggleTask(task.id);
    if (updated && onUpdated) onUpdated(updated);
  };

  const handleDelete = () => {
    // Owner ODER Admin → Wahldialog. Andere → direkt dismissen.
    if (isOwnerResolved || isGroupAdminTask) {
      setDeleteChoiceOpen(true);
      return;
    }
    deleteTask(task.id, { mode: 'dismiss' });
    onClose();
  };

  const handleAddComment = async () => {
    const text = commentText.trim();
    if (!text) return;
    const optimistic = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      emoji: '💬', text,
      author: currentUser?.name || 'Du',
      author_avatar_url: currentUser?.avatar_url || null,
      author_color: currentUser?.avatar_color || currentUser?.color || '#007AFF',
      created_at: new Date().toISOString(),
      user_id: currentUser?.id || null,
    };
    setCommentText('');
    setComments((prev) => [...prev, optimistic]);
    try {
      const res = await api.addComment(task.id, '💬', text);
      if (res.comment) {
        setComments((prev) => prev.map((c) => (c.id === optimistic.id ? res.comment : c)));
        addToast('Kommentar hinzugefügt');
      }
    } catch {
      setComments((prev) => prev.filter((c) => c.id !== optimistic.id));
      addToast('Kommentar konnte nicht gespeichert werden');
    }
  };

  const buildShareText = () => {
    const lines = [];
    lines.push(isEvent ? `Termin: ${task.title}` : `Aufgabe: ${task.title}`);
    if (task.date) {
      const dateLabel = formatDate(task.date);
      lines.push(`Datum: ${dateLabel}`);
    }
    if (task.time) {
      const timeStr = task.time.slice(0, 5) + (task.time_end ? ` – ${task.time_end.slice(0, 5)}` : '');
      lines.push(`Uhrzeit: ${timeStr}`);
    }
    if (task.category_name) lines.push(`Kategorie: ${task.category_name}`);
    if (task.priority) {
      const prioLabels = { low: 'Niedrig', medium: 'Mittel', high: 'Hoch', urgent: 'Dringend' };
      lines.push(`Priorität: ${prioLabels[task.priority] || task.priority}`);
    }
    if (task.description) lines.push(`\n${task.description}`);
    if (task.location && task.location.trim()) {
      lines.push(`\n📍 ${task.location.trim()}`);
      lines.push(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(task.location.trim())}`);
    }
    lines.push('\nBeeQu – smarter planen. https://beequ.app');
    return lines.join('\n');
  };

  const handleShare = async (target) => {
    setShowMenu(false);
    setShowShareMenu(false);
    const text = buildShareText();
    const link = `https://beequ.app/?task=${task.id}`;
    if (target === 'native' && navigator.share) {
      try { await navigator.share({ title: task.title, text, url: link }); } catch { /* abgebrochen */ }
      return;
    }
    if (target === 'whatsapp') {
      window.open(`https://wa.me/?text=${encodeURIComponent(text + '\n' + link)}`, '_blank', 'noopener,noreferrer');
      return;
    }
    if (target === 'copy') {
      try {
        await navigator.clipboard.writeText(link);
        addToast('Link kopiert');
      } catch {
        addToast('Kopieren fehlgeschlagen');
      }
    }
  };

  const handleShareToGroupChat = async () => {
    if (!task.group_id || sharingToChat) return;
    setSharingToChat(true);
    try {
      await api.shareTaskToGroupChat(task.group_id, task.id);
      addToast('📤 In den Gruppen-Chat geteilt');
    } catch (err) {
      addToast(err.message || 'Teilen fehlgeschlagen', 'error');
    } finally {
      setSharingToChat(false);
    }
  };

  const handleVote = async (status) => {
    if (!task?.id || voting) return;
    setVoting(true);
    try {
      const next = taskVotes.my_vote === status ? null : status;
      const res = await api.voteTask(task.id, next);
      setTaskVotes({
        yes_count: Number(res?.yes_count || 0),
        no_count: Number(res?.no_count || 0),
        yes_users: Array.isArray(res?.yes_users) ? res.yes_users : [],
        no_users: Array.isArray(res?.no_users) ? res.no_users : [],
        unanswered_users: Array.isArray(res?.unanswered_users) ? res.unanswered_users : [],
        my_vote: res?.my_vote || null,
        member_count: Number.isFinite(Number(res?.member_count)) ? Number(res.member_count) : null,
        unanswered_count: Number.isFinite(Number(res?.unanswered_count)) ? Number(res.unanswered_count) : null,
      });
    } catch {
      addToast('Abstimmung konnte nicht gespeichert werden');
    } finally {
      setVoting(false);
    }
  };

  const renderVoteSection = () => (
    <div className={`task-detail-section task-detail-votes-section${voteNeedsAction ? ' vote-needs-action' : ''}`}>
      <div className="task-detail-description-header">
        <ThumbsUp size={16} /><span>Abstimmung</span>
      </div>
      <div className="task-detail-vote-surface">
        {voteNeedsAction && (
          <div className="task-detail-vote-cta">Bitte stimme jetzt ab, damit die Gruppe direkt planen kann.</div>
        )}

        <div className={`task-detail-vote-actions${voteNeedsAction ? ' is-unvoted' : ''}`}>
          <button
            type="button"
            className={`task-detail-vote-btn yes ${taskVotes.my_vote === 'yes' ? 'active' : ''}`}
            onClick={() => handleVote('yes')}
            disabled={voting}
          >
            <ThumbsUp size={14} />
            <span>Zusagen</span>
            <span className="task-detail-vote-btn-count">{voteYesCount}</span>
          </button>
          <button
            type="button"
            className={`task-detail-vote-btn no ${taskVotes.my_vote === 'no' ? 'active' : ''}`}
            onClick={() => handleVote('no')}
            disabled={voting}
          >
            <ThumbsDown size={14} />
            <span>Absagen</span>
            <span className="task-detail-vote-btn-count">{voteNoCount}</span>
          </button>
          {votePendingCount !== null && (
            <button
              type="button"
              className={`task-detail-vote-btn pending ${votesOpen === 'pending' ? 'active' : ''}`}
              onClick={() => setVotesOpen(votesOpen === 'pending' ? null : 'pending')}
              disabled={voting}
              title="Unbeantwortete anzeigen"
            >
              <Users size={13} />
              <span>Unbeantwortet</span>
              <span className="task-detail-vote-btn-count">{votePendingCount}</span>
            </button>
          )}
        </div>

        <div className="task-detail-vote-attendees">
          {taskVotes.yes_users.length > 0 && (
            <button
              type="button"
              className="task-detail-vote-stack-btn task-detail-vote-stack-btn--yes"
              onClick={() => setVotesOpen(votesOpen === 'yes' ? null : 'yes')}
              title={`Zusagen (${taskVotes.yes_users.length})`}
            >
              <ThumbsUp size={12} />
              <span className="task-detail-vote-stack">
                {taskVotes.yes_users.slice(0, 5).map((u, i) => (
                  <span key={`yes_${i}`} className="task-detail-vote-avatar-wrap" style={{ zIndex: 6 - i }}>
                    <AvatarBadge name={u.name} color={u.avatar_color || '#4C7BD9'} avatarUrl={u.avatar_url} size={22} />
                  </span>
                ))}
                {taskVotes.yes_users.length > 5 && (
                  <span className="task-detail-vote-avatar-wrap task-detail-vote-avatar-wrap--more">+{taskVotes.yes_users.length - 5}</span>
                )}
              </span>
              <span className="task-detail-vote-count">{taskVotes.yes_users.length}</span>
            </button>
          )}
          {taskVotes.no_users.length > 0 && (
            <button
              type="button"
              className="task-detail-vote-stack-btn task-detail-vote-stack-btn--no"
              onClick={() => setVotesOpen(votesOpen === 'no' ? null : 'no')}
              title={`Absagen (${taskVotes.no_users.length})`}
            >
              <ThumbsDown size={12} />
              <span className="task-detail-vote-stack">
                {taskVotes.no_users.slice(0, 5).map((u, i) => (
                  <span key={`no_${i}`} className="task-detail-vote-avatar-wrap" style={{ zIndex: 6 - i }}>
                    <AvatarBadge name={u.name} color={u.avatar_color || '#8e8e93'} avatarUrl={u.avatar_url} size={22} />
                  </span>
                ))}
                {taskVotes.no_users.length > 5 && (
                  <span className="task-detail-vote-avatar-wrap task-detail-vote-avatar-wrap--more">+{taskVotes.no_users.length - 5}</span>
                )}
              </span>
              <span className="task-detail-vote-count">{taskVotes.no_users.length}</span>
            </button>
          )}
          {taskVotes.unanswered_users.length > 0 && (
            <button
              type="button"
              className="task-detail-vote-stack-btn task-detail-vote-stack-btn--pending"
              onClick={() => setVotesOpen(votesOpen === 'pending' ? null : 'pending')}
              title={`Unbeantwortet (${taskVotes.unanswered_users.length})`}
            >
              <Users size={12} />
              <span className="task-detail-vote-stack">
                {taskVotes.unanswered_users.slice(0, 5).map((u, i) => (
                  <span key={`pending_${i}`} className="task-detail-vote-avatar-wrap" style={{ zIndex: 6 - i }}>
                    <AvatarBadge name={u.name} color={u.avatar_color || '#8e8e93'} avatarUrl={u.avatar_url} size={22} />
                  </span>
                ))}
                {taskVotes.unanswered_users.length > 5 && (
                  <span className="task-detail-vote-avatar-wrap task-detail-vote-avatar-wrap--more">+{taskVotes.unanswered_users.length - 5}</span>
                )}
              </span>
              <span className="task-detail-vote-count">{taskVotes.unanswered_users.length}</span>
            </button>
          )}

          {votesOpen && (() => {
            const isYes = votesOpen === 'yes';
            const isNo = votesOpen === 'no';
            const users = isYes
              ? taskVotes.yes_users
              : (isNo ? taskVotes.no_users : taskVotes.unanswered_users);
            return (
              <div className={`task-detail-vote-popup ${isYes ? 'task-detail-vote-popup--yes' : (isNo ? 'task-detail-vote-popup--no' : 'task-detail-vote-popup--pending')}`}>
                <div className="task-detail-vote-popup-head">
                  {isYes ? <ThumbsUp size={12} /> : (isNo ? <ThumbsDown size={12} /> : <Users size={12} />)}
                  <span>{isYes ? 'Zusagen' : (isNo ? 'Absagen' : 'Unbeantwortet')} ({users.length})</span>
                  <button type="button" className="task-detail-vote-popup-close" onClick={() => setVotesOpen(null)}><X size={12} /></button>
                </div>
                <div className="task-detail-vote-popup-list">
                  {users.map((u, i) => (
                    <div key={`${isYes ? 'py' : (isNo ? 'pn' : 'pp')}_${i}`} className="task-detail-vote-popup-row">
                      <AvatarBadge name={u.name} color={u.avatar_color || (isYes ? '#4C7BD9' : '#8e8e93')} avatarUrl={u.avatar_url} size={24} />
                      <span className="task-detail-vote-popup-name">{u.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );

  const content = (
    <motion.div
      className={`task-detail-modal${pageMode ? ' task-detail-page-mode' : ''}${isMobile ? ' is-mobile-fullscreen' : ''}${!isEvent ? ' is-task-detail' : ''}`}
      initial={isMobile ? { y: '100%' } : (pageMode ? { opacity: 0, x: 30 } : { opacity: 0, y: 24 })}
      animate={isMobile ? { y: pullOffset } : (pageMode ? { opacity: 1, x: 0 } : { opacity: 1, y: 0 })}
      exit={isMobile ? { y: '100%' } : (pageMode ? {} : { opacity: 0, y: 16 })}
      transition={{
        type: 'tween',
        duration: isMobile ? (pullOffset > 0 ? 0 : 0.16) : (pageMode ? 0.22 : 0.2),
        ease: 'easeOut'
      }}
      onClick={(!pageMode && !isMobile) ? (e) => e.stopPropagation() : undefined}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className={`task-detail-main${hasGroupWatermark ? ' has-group-watermark' : ''}`}>
        <div className={`task-detail-top-shadow${scrollDarkened ? ' visible' : ''}`} aria-hidden="true" />
        {hasGroupWatermark && (
          <div className="task-detail-group-watermark" aria-hidden="true">
            <img src={groupWatermarkUrl} alt="" loading="lazy" />
          </div>
        )}
        <div className="task-detail-sticky-top" ref={stickyTopRef}>
          <div className="task-detail-header">
            {pageMode && (
              <button className="task-detail-back-btn" onClick={onClose}>
                <ArrowLeft size={18} />
              </button>
            )}
            <div className="task-detail-priority-bar" style={{ background: priority.color }} />
            {isMobile && <div className={`modal-pull-handle${pullHandleHidden ? ' pull-handle-hidden' : ''}`} />}
            <div className={`task-detail-sticky-title${titleHidden ? ' visible' : ''}`}>
              <span>{task.title}</span>
            </div>
            <div className="task-detail-header-actions" ref={menuRef} style={{ zIndex: 200, pointerEvents: 'auto' }}>
              <button className="task-detail-more-btn" onClick={() => setShowMenu((s) => !s)} title="Mehr" aria-label="Mehr" style={{ position: 'relative', zIndex: 201, pointerEvents: 'auto' }}>
                <MoreVertical size={18} />
              </button>
              {showMenu && (
                <div className="task-detail-more-menu">
                  {canEdit && (
                    <button className="task-detail-more-item" onClick={() => { setShowMenu(false); setShowEdit(true); }}>
                      Bearbeiten
                    </button>
                  )}
                  <div className="task-detail-more-item-wrap">
                    <button
                      className="task-detail-more-item"
                      onClick={() => { setShowMenu(false); setShowShareMenu(false); setShareSheetOpen(true); }}
                    >
                      <Share2 size={14} style={{ marginRight: 6 }} />
                      Teilen…
                    </button>
                  </div>
                  {(isOwnerResolved || isGroupAdminTask) ? (
                    <button className="task-detail-more-item danger" onClick={() => { setShowMenu(false); handleDelete(); }}>
                      {task?.type === 'event' ? 'Termin löschen…' : 'Aufgabe löschen…'}
                    </button>
                  ) : (
                    <button className="task-detail-more-item danger" onClick={() => { setShowMenu(false); handleDelete(); }}>
                      {task?.type === 'event' ? 'Termin aus meinem Kalender entfernen' : 'Aufgabe aus meinem Kalender entfernen'}
                    </button>
                  )}
                </div>
              )}
              {!pageMode && (
                <button className="task-detail-close" onClick={onClose} style={{ position: 'relative', zIndex: 201, pointerEvents: 'auto' }}><X size={20} /></button>
              )}
            </div>
          </div>
        </div>

        <div className="task-detail-title-row" ref={titleRef}>
          {isEvent ? (
            <div className="task-detail-event-icon"><CalendarCheck size={28} /></div>
          ) : (
            <motion.div className={`task-detail-checkbox ${task.completed ? 'checked' : ''}`} onClick={handleToggle} whileTap={{ scale: 0.85 }}>
              {task.completed ? <CheckCircle2 size={28} /> : <Circle size={28} />}
            </motion.div>
          )}
          <div>
            <h2 className={`task-detail-title ${task.completed && !isEvent ? 'completed' : ''}`}>{task.title}</h2>
            {!isEvent && <span className="task-detail-status task">Aufgabe</span>}
            {isEvent && <span className="task-detail-status event">Termin</span>}
            {isEvent && isEventEnded && <span className="task-detail-status ended">Beendet</span>}
            {!isEvent && task.completed && <span className="task-detail-status done">Erledigt</span>}
            {isOverdue && !isEvent && <span className="task-detail-status overdue">Überfällig</span>}
          </div>
        </div>

        {task.teams_join_url && (
          <div className="task-detail-section task-detail-teams-card">
            <div className="task-detail-teams-top">
              <div className="task-detail-teams-icon"><Video size={18} /></div>
              <div>
                <div className="task-detail-teams-title">Teams-Meeting aktiv</div>
                <div className="task-detail-teams-copy">Für diesen Termin wurde ein Microsoft-Teams-Meeting erstellt.</div>
              </div>
            </div>
            <a href={task.teams_join_url} target="_blank" rel="noopener noreferrer" className="task-detail-teams-join">
              <Video size={16} /> Via Teams beitreten
            </a>
          </div>
        )}

        <div className="task-detail-grid">
          {task.date && (
            <button
              type="button"
              className={`task-detail-item task-detail-item--dt${canEdit ? ' task-detail-item--editable' : ''}${showDateTimeEdit ? ' active' : ''}`}
              onClick={canEdit ? openDateTimeEdit : undefined}
              disabled={!canEdit}
            >
              <div className="task-detail-item-icon" style={isOverdue ? { color: 'var(--danger)' } : {}}><Calendar size={18} /></div>
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div className="task-detail-item-label">{task.date_end && task.date_end !== task.date ? 'Zeitraum' : 'Datum'}</div>
                {task.date_end && task.date_end !== task.date ? (
                  <div className="task-detail-daterange" style={isOverdue ? { color: 'var(--danger)' } : {}}>
                    <div className="task-detail-daterange-row">
                      <span className="task-detail-daterange-tag">Von</span>
                      <span className="task-detail-daterange-date">{formatDate(task.date)}</span>
                    </div>
                    <div className="task-detail-daterange-row">
                      <span className="task-detail-daterange-tag">Bis</span>
                      <span className="task-detail-daterange-date">{formatDate(task.date_end)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="task-detail-item-value" style={isOverdue ? { color: 'var(--danger)' } : {}}>
                    {formatDate(task.date)}
                  </div>
                )}
              </div>
              {canEdit && <Settings2 size={12} className="task-detail-item-edit-hint" />}
            </button>
          )}
          {task.time && (
            <button
              type="button"
              className={`task-detail-item task-detail-item--dt${canEdit ? ' task-detail-item--editable' : ''}${showDateTimeEdit ? ' active' : ''}`}
              onClick={canEdit ? openDateTimeEdit : undefined}
              disabled={!canEdit}
            >
              <div className="task-detail-item-icon"><Clock size={18} /></div>
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div className="task-detail-item-label">Uhrzeit</div>
                <div className="task-detail-time-range">
                  <span className="task-detail-time-chip">{task.time.slice(0, 5)}</span>
                  {task.time_end && (
                    <>
                      <span className="task-detail-time-arrow">→</span>
                      <span className="task-detail-time-chip task-detail-time-chip--end">{task.time_end.slice(0, 5)}</span>
                    </>
                  )}
                </div>
              </div>
              {canEdit && <Settings2 size={12} className="task-detail-item-edit-hint" />}
            </button>
          )}
          {!task.date && canEdit && (
            <button
              type="button"
              className={`task-detail-item task-detail-item--dt task-detail-item--editable task-detail-item--add-date${showDateTimeEdit ? ' active' : ''}`}
              onClick={openDateTimeEdit}
            >
              <div className="task-detail-item-icon"><Calendar size={18} /></div>
              <span style={{ textAlign: 'left', fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>Datum hinzufügen</span>
            </button>
          )}

          <div className="task-detail-item">
            <div className="task-detail-item-icon" style={{ color: priority.color }}><PriorityIcon size={18} /></div>
            <div>
              <div className="task-detail-item-label">Priorität</div>
              <div className="task-detail-item-value" style={{ color: priority.color }}>{priority.label}</div>
            </div>
          </div>
          {task.category_name && (
            <div className="task-detail-item">
              <div className="task-detail-item-icon" style={{ color: task.category_color || 'var(--primary)' }}><Tag size={18} /></div>
              <div>
                <div className="task-detail-item-label">Kategorie</div>
                <div className="task-detail-item-value">
                  <span className="task-detail-category-badge" style={{ background: task.category_color ? `${task.category_color}18` : 'var(--primary-bg)', color: task.category_color || 'var(--primary)' }}>
                    {task.category_name}
                  </span>
                </div>
              </div>
            </div>
          )}
          {task.group_category_name && (
            <div className="task-detail-item">
              <div className="task-detail-item-icon" style={{ color: task.group_category_color || '#8E8E93' }}><Tag size={18} /></div>
              <div>
                <div className="task-detail-item-label">Gruppenkategorie</div>
                <div className="task-detail-item-value">
                  <span className="task-detail-category-badge" style={{ background: task.group_category_color ? `${task.group_category_color}18` : 'rgba(142,142,147,0.12)', color: task.group_category_color || '#636366', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: task.group_category_color || '#8E8E93', flexShrink: 0, display: 'inline-block' }} />
                    {task.group_category_name}
                  </span>
                </div>
              </div>
            </div>
          )}
          {task.reminder_at && (
            <div className="task-detail-item">
              <div className="task-detail-item-icon" style={{ color: 'var(--warning)' }}><Bell size={18} /></div>
              <div>
                <div className="task-detail-item-label">Erinnerung</div>
                <div className="task-detail-item-value">{format(parseISO(task.reminder_at), 'd. MMM, HH:mm', { locale: de })} Uhr</div>
              </div>
            </div>
          )}
          {task.recurrence_rule && (
            <div className="task-detail-item">
              <div className="task-detail-item-icon" style={{ color: '#007AFF' }}><Repeat size={18} /></div>
              <div>
                <div className="task-detail-item-label">Wiederholung</div>
                <div className="task-detail-item-value" style={{ color: '#007AFF' }}>
                  {{ daily: 'Täglich', weekly: 'Wöchentlich', biweekly: 'Alle 2 Wochen', monthly: 'Monatlich', yearly: 'Jährlich', weekdays: 'Werktags (Mo–Fr)' }[task.recurrence_rule] || task.recurrence_rule}
                  {task.recurrence_end && ` bis ${format(parseISO(task.recurrence_end), 'd. MMM yyyy', { locale: de })}`}
                </div>
              </div>
            </div>
          )}
          {task.location && task.location.trim() && (
            <button
              type="button"
              ref={mapBtnRef}
              className="task-detail-item task-detail-item--editable task-detail-item--location"
              onClick={(e) => {
                e.stopPropagation();
                if (!showMapChoice && mapBtnRef.current && window.innerWidth > 600) {
                  const r = mapBtnRef.current.getBoundingClientRect();
                  setMapChoicePos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
                } else {
                  setMapChoicePos(null);
                }
                setShowMapChoice((s) => !s);
              }}
              aria-haspopup="menu"
              aria-expanded={showMapChoice}
            >
              <div className="task-detail-item-icon" style={{ color: '#EE0979' }}><MapPin size={18} /></div>
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div className="task-detail-item-label">Ort</div>
                <div className="task-detail-item-value task-detail-item-value--location">{task.location.trim()}</div>
              </div>
              <ExternalLink size={12} className="task-detail-item-edit-hint" />
            </button>
          )}
        </div>

        {/* Datum & Uhrzeit Drum-Picker */}
        <AnimatePresence>
          {showDateTimeEdit && canEdit && (
            <motion.div className="drum-panel"
              initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: 'easeInOut' }}
              style={{ overflow: 'hidden' }}>
              <div className="drum-panel-inner">
                {/* Datum */}
                <div className="drum-section">
                  <div className="drum-section-label">
                    {dtEndDateEnabled ? 'Von' : 'Datum'}
                    <button
                      type="button"
                      className="drum-end-toggle"
                      onClick={() => setDtEndDateEnabled((e) => {
                        const next = !e;
                        if (next && (!dtDateEnd || dtDateEnd < dtDate)) setDtDateEnd(dtDate);
                        return next;
                      })}
                    >
                      {dtEndDateEnabled ? '✕' : '+ Enddatum'}
                    </button>
                  </div>
                  <WheelCol key={`d-${showDateTimeEdit}`} items={dateItems} initialValue={dtDate} onChange={setDtDate} />
                </div>
                {dtEndDateEnabled && (
                  <>
                    <div className="drum-divider" />
                    <div className="drum-section">
                      <div className="drum-section-label">Bis</div>
                      <WheelCol key={`d2-${showDateTimeEdit}`} items={dateItems} initialValue={dtDateEnd} onChange={setDtDateEnd} />
                    </div>
                  </>
                )}
                <div className="drum-divider" />
                {/* Von */}
                <div className="drum-section">
                  <div className="drum-section-label">Von</div>
                  <div className="drum-time-pair">
                    <WheelCol key={`vh-${showDateTimeEdit}`} items={HOUR_ITEMS} initialValue={dtHour} onChange={setDtHour} />
                    <div className="drum-colon">:</div>
                    <WheelCol key={`vm-${showDateTimeEdit}`} items={MINUTE_ITEMS} initialValue={dtMinute} onChange={setDtMinute} />
                  </div>
                </div>
                <div className="drum-divider" />
                {/* Bis */}
                <div className="drum-section">
                  <div className="drum-section-label">
                    Bis
                    <button type="button" className="drum-end-toggle" onClick={() => setDtEndEnabled((e) => !e)}>
                      {dtEndEnabled ? '✕' : '+ Endzeit'}
                    </button>
                  </div>
                  {dtEndEnabled ? (
                    <div className="drum-time-pair">
                      <WheelCol key={`bh-${showDateTimeEdit}`} items={HOUR_ITEMS} initialValue={dtEndHour} onChange={setDtEndHour} />
                      <div className="drum-colon">:</div>
                      <WheelCol key={`bm-${showDateTimeEdit}`} items={MINUTE_ITEMS} initialValue={dtEndMinute} onChange={setDtEndMinute} />
                    </div>
                  ) : (
                    <div className="drum-no-end">—</div>
                  )}
                </div>
              </div>
              <div className="drum-panel-footer">
                <button type="button" className="drum-cancel" onClick={() => setShowDateTimeEdit(false)}>Abbrechen</button>
                {task.date && <button type="button" className="drum-clear" onClick={() => { setDtDate(''); handleSaveDateTime(); }}>Löschen</button>}
                <motion.button type="button" className="drum-save" onClick={handleSaveDateTime} disabled={dtSaving} whileTap={{ scale: 0.97 }}>
                  {dtSaving ? '…' : 'Speichern'}
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="task-detail-section">
          <div className="task-detail-description-header">
            {task.description?.includes('•') ? <ListChecks size={16} /> : <FileText size={16} />}
            <span>{task.description?.includes('•') ? 'Liste' : 'Details'}</span>
          </div>
          <div className="task-detail-description">
            {task.description
              ? task.description.split('\n').map((line, i) => (
                  <div key={i} className={line.startsWith('•') ? 'task-detail-list-item' : 'task-detail-desc-line'}>
                    {line.startsWith('•') ? (<><span className="task-detail-bullet">•</span>{line.substring(1).trim()}</>) : line}
                  </div>
                ))
              : <div className="task-detail-desc-line">Keine Details hinterlegt.</div>}
          </div>
        </div>

        {/* Verknuepfte Notizen (bidirektional via notes.linked_task_id) */}
        <LinkedNotesSection
          task={task}
          notesAll={notesAll}
          updateNoteStore={updateNoteStore}
          onOpenNote={(noteId) => setOpenNoteId(noteId)}
          pickerOpen={notePickerOpen}
          setPickerOpen={setNotePickerOpen}
          pickerQuery={notePickerQuery}
          setPickerQuery={setNotePickerQuery}
          currentUserId={currentUserId}
        />

        {task.location && task.location.trim() && showMapChoice && createPortal(
          <>
            <div className="task-detail-mapchoice-backdrop" onClick={() => setShowMapChoice(false)} />
            <motion.div
              className="task-detail-mapchoice"
              role="menu"
              style={mapChoicePos ? { position: 'fixed', top: mapChoicePos.top, right: mapChoicePos.right } : undefined}
              initial={{ opacity: 0, y: -6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.14 }}
            >
                  <div className="task-detail-mapchoice-title">Öffnen mit</div>
                  <a
                    className="task-detail-mapchoice-item"
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(task.location.trim())}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setShowMapChoice(false)}
                    role="menuitem"
                  >
                    <span className="task-detail-mapchoice-logo google">G</span>
                    <span className="task-detail-mapchoice-label">
                      <span className="task-detail-mapchoice-name">Google Maps</span>
                      <span className="task-detail-mapchoice-sub">Browser / App</span>
                    </span>
                    <ExternalLink size={13} />
                  </a>
                  <a
                    className="task-detail-mapchoice-item"
                    href={`https://maps.apple.com/?q=${encodeURIComponent(task.location.trim())}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setShowMapChoice(false)}
                    role="menuitem"
                  >
                    <span className="task-detail-mapchoice-logo apple"></span>
                    <span className="task-detail-mapchoice-label">
                      <span className="task-detail-mapchoice-name">Apple Karten</span>
                      <span className="task-detail-mapchoice-sub">iOS / macOS</span>
                    </span>
                    <ExternalLink size={13} />
                  </a>
            </motion.div>
          </>,
          document.body
        )}

        {isMobile && task.group_id && task.enable_group_rsvp === true && isGroupMember && renderVoteSection()}

        <TaskAttachments taskId={task.id} canEdit={canEdit} />

        {task.created_at && (
          <div className="task-detail-footer-info">
            Erstellt am {format(parseISO(task.created_at), 'd. MMMM yyyy, HH:mm', { locale: de })} Uhr
          </div>
        )}
        <div className="task-detail-actions">
          {task.group_id && !(isEvent && isEventEnded) && (
            <motion.button className="task-detail-btn edit" onClick={handleShareToGroupChat} whileTap={{ scale: 0.97 }} disabled={sharingToChat}>
              <Share2 size={18} /> {sharingToChat ? 'Teile...' : 'In Chat teilen'}
            </motion.button>
          )}
          {canEdit && !isEvent && (
            <motion.button className={`task-detail-btn ${task.completed ? 'reopen' : 'complete'}`} onClick={handleToggle} whileTap={{ scale: 0.97 }}>
              {task.completed ? <><Circle size={18} /> Wieder öffnen</> : <><CheckCircle2 size={18} /> Als erledigt markieren</>}
            </motion.button>
          )}
        </div>
      </div>

      <div className="task-detail-aside">
        {/* "Mit dir geteilt" – nur für direkt geteilte persönliche Tasks */}
        {isDirectShareToMe && (
          <div className="shared-with-me-card">
            <div className="shared-with-me-header">
              <UserCheck size={13} />
              <span>Mit dir geteilt</span>
            </div>
            {task.creator_name && (
              <div className="shared-with-me-creator">
                <AvatarBadge
                  name={task.creator_name}
                  color={task.creator_color || '#007AFF'}
                  avatarUrl={task.creator_avatar_url}
                  size={26}
                />
                <div>
                  <div className="shared-with-me-creator-label">Von</div>
                  <div className="shared-with-me-creator-name">{task.creator_name}</div>
                </div>
              </div>
            )}
            <div className="shared-with-me-access">
              {canEdit
                ? <><Edit3 size={11} /><span>Bearbeiten erlaubt</span></>
                : <><Eye size={11} /><span>Nur lesen</span></>}
            </div>
            {canManageShare && (
              <button
                type="button"
                className="task-edit-pill active shared-with-me-forward-btn"
                style={{ marginTop: 8 }}
                onClick={() => setShowSharePanel((s) => !s)}
              >
                <Share2 size={12} /> Weiterteilen
              </button>
            )}
          </div>
        )}

        {/* Teilen */}
        {(!isDirectShareToMe ? (canShare || isExternallySharedTask) : canManageShare) && (
          <div className="shr-wrap">
            {/* Kompakte Status-Zeile */}
            {!isDirectShareToMe && (!canManageShare ? (
              /* Empfänger mit Nur-Lesen: nur Anzeige, kein Aufklappen */
              <div className="shr-row shr-row-readonly">
                <div className="shr-row-main">
                  <div className={`shr-row-vis-dot ${shareRowVisibility}`} />
                  <div className="shr-row-copy">
                    <span className="shr-row-label">{shareRowLabel}</span>
                    <span className="shr-row-sub">
                      {shareRowVisibility === 'private' && (isGroupContextTask ? 'Fuer Gruppenmitglieder sichtbar' : 'Nicht mit anderen geteilt')}
                      {shareRowVisibility === 'shared' && 'Sichtbar für alle Freunde'}
                      {shareRowVisibility === 'selected_users' && (canEdit ? 'Gezielt mit dir geteilt (Bearbeiten)' : 'Gezielt mit dir geteilt (Nur lesen)')}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              /* Besitzer oder Empfänger mit Bearbeiten: klickbar, Panel aufklappbar */
              <button type="button" className={`shr-row${showSharePanel ? ' open' : ''}`} onClick={() => setShowSharePanel(s => !s)}>
                <div className="shr-row-main">
                  <div className={`shr-row-vis-dot ${shareRowVisibility}`} />
                  <div className="shr-row-copy">
                    <span className="shr-row-label">{shareRowLabel}</span>
                    <span className="shr-row-sub">
                      {shareRowVisibility === 'private' && (isGroupContextTask ? 'Fuer Gruppenmitglieder sichtbar' : 'Nicht mit anderen geteilt')}
                      {shareRowVisibility === 'shared' && 'Sichtbar fuer alle Freunde'}
                      {shareRowVisibility === 'selected_users' && (!isOwnerResolved ? 'Gezielt mit Personen geteilt (Du darfst weiterteilen)' : 'Gezielt mit Personen geteilt')}
                    </span>
                  </div>
                </div>
                {canSeePrivateShareInfo && shareRowUsers.length > 0 && (
                  <div className="shr-row-avatars">
                    {shareRowUsers.slice(0, 4).map((p, i) => (
                      <span key={p.user_id} className="shr-row-avatar" style={{ zIndex: 10 - i, marginLeft: i > 0 ? -8 : 0 }}>
                        <AvatarBadge name={p.name} color={p.avatar_color || '#007AFF'} avatarUrl={p.avatar_url} size={22} />
                      </span>
                    ))}
                    {shareRowUsers.length > 4 && <span className="shr-row-avatar-more">+{shareRowUsers.length - 4}</span>}
                  </div>
                )}
                <span className="shr-row-edit-hint">{!isOwnerResolved ? 'Weiterteilen' : 'Bearbeiten'} <ChevronDown size={12} className={showSharePanel ? 'shr-chevron-open' : ''} /></span>
              </button>
            ))}

            <AnimatePresence initial={false}>
              {showSharePanel && canManageShare && (
                <motion.div className="shr-panel"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}>
                  {shareLoading ? (
                    <div className="shr-panel-inner shr-panel-skeleton">
                      <div className="shr-skel shr-skel-tiles" />
                      <div className="shr-skel shr-skel-line" />
                      <div className="shr-skel shr-skel-line short" />
                    </div>
                  ) : (
                    <div className="shr-panel-inner">

                      {/* Sichtbarkeit: 3 Kacheln – nur für Besitzer */}
                      {isOwnerResolved && (isGroupAdmin || !task.group_id) && (
                        <div className="shr-vis-tiles">
                          {[
                            { value: 'private', Icon: Lock, label: 'Privat', sub: 'Nur du', color: '#8E8E93' },
                            { value: 'shared', Icon: Users, label: 'Alle Freunde', sub: 'Alle sehen', color: '#007AFF' },
                            { value: 'selected_users', Icon: UserCheck, label: 'Auswahl', sub: 'Bestimmte', color: '#34C759' },
                          ].map(({ value, Icon, label, sub, color }) => (
                            <button key={value} type="button"
                              className={`shr-vis-tile${shareVisibility === value ? ' active' : ''}`}
                              style={shareVisibility === value ? { '--tc': color } : {}}
                              onClick={() => { setShareVisibility(value); if (value !== 'selected_users') setSharePermissions([]); }}>
                              <div className="shr-vis-tile-icon"><Icon size={16} /></div>
                              <span className="shr-vis-tile-label">{label}</span>
                              <span className="shr-vis-tile-sub">{sub}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Info für Gruppenaufgaben-Sharing */}
                      {isGroupTaskSharingExternally && (
                        <div className="shr-external-note">
                          Externe Nutzer erhalten eine schreibgeschützte Kopie dieses Gruppe-Termins. Der Zugriff ist auf Leseberechtigung beschränkt.
                        </div>
                      )}

                      {/* Personen wählen – Avatar-Strip – nur für Besitzer */}
                      {canManageShare && ((isOwnerResolved && (isGroupAdmin || !task.group_id) ? shareVisibility === 'selected_users' : true) || !isOwnerResolved) && shareTargetFriends.length > 0 && (
                        <div className="shr-friends">
                          <div className="shr-friends-label">Freunde</div>
                          <div className="shr-friends-strip">
                            {shareTargetFriends.map((f) => {
                              const selected = sharePermissions.find(p => p.user_id === f.friend_user_id);
                              return (
                                <button key={f.friend_user_id} type="button"
                                  className={`shr-friend-chip${selected ? ' selected' : ''}`}
                                  onClick={() => selected
                                    ? setSharePermissions(prev => prev.filter(p => p.user_id !== f.friend_user_id))
                                    : setSharePermissions(prev => [...prev, { user_id: f.friend_user_id, can_view: true, can_edit: false, name: f.name, avatar_color: f.avatar_color, avatar_url: f.avatar_url }])
                                  }>
                                  <div className="shr-friend-chip-av">
                                    <AvatarBadge name={f.name} color={f.avatar_color || '#007AFF'} avatarUrl={f.avatar_url} size={36} />
                                    {selected && <div className="shr-friend-chip-check">✓</div>}
                                  </div>
                                  <span className="shr-friend-chip-name">{f.name.split(' ')[0]}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Berechtigungen – nur für Besitzer, nie für Empfänger */}
                      {canManageShare && canSeePrivateShareInfo && sharePermissions.length > 0 && (isOwnerResolved ? (isGroupAdmin || !task.group_id) : true) && (
                        <div className="shr-perms">
                          {sharePermissions.map((p) => (
                            <div key={p.user_id} className="shr-perm-row">
                              <AvatarBadge name={p.name} color={p.avatar_color || '#007AFF'} avatarUrl={p.avatar_url} size={26} />
                              <span className="shr-perm-name">{p.name}</span>
                              <div className="shr-perm-toggle">
                                <button type="button" className={`shr-perm-opt${!p.can_edit ? ' on' : ''}`}
                                  onClick={() => setSharePermissions(prev => prev.map(pp => pp.user_id === p.user_id ? { ...pp, can_edit: false } : pp))}>
                                  <Eye size={11} /> Lesen
                                </button>
                                {!isGroupTaskSharingExternally && (
                                  <button type="button" className={`shr-perm-opt${p.can_edit ? ' on' : ''}`}
                                    onClick={() => setSharePermissions(prev => prev.map(pp => pp.user_id === p.user_id ? { ...pp, can_edit: true } : pp))}>
                                    <Edit3 size={11} /> Bearbeiten
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {canManageShare && (
                      <motion.button type="button" className="shr-save" onClick={handleSaveShare} disabled={shareSaving} whileTap={{ scale: 0.97 }}>
                        {shareSaving ? 'Speichert…' : 'Speichern'}
                      </motion.button>
                      )}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* ── Gruppe + Untergruppe: eine gemeinsame Karte ── */}
        {(task.group_name && (isOwnerResolved || isGroupMember)) && (
          <div className="task-detail-section task-detail-collab task-detail-group-subgroup-card"
            style={{ '--group-color': task.group_color || '#5856D6' }}>

            {/* Gruppe-Zeile */}
            {task.group_name && (
              <div className="task-detail-group-row">
                <div className="task-detail-group-row-icon">
                  <AvatarBadge name={task.group_name} color={task.group_color || '#5856D6'} avatarUrl={task.group_image_url} size={34} />
                </div>
                <div className="task-detail-group-row-info">
                  <span className="task-detail-group-row-label">Gruppe</span>
                  <span className="task-detail-group-row-name">{task.group_name}</span>
                  {task.group_task_creator_name && (
                    <span className="task-detail-group-row-creator">
                      <AvatarBadge name={task.group_task_creator_name} color={task.group_task_creator_color || '#007AFF'} avatarUrl={task.group_task_creator_avatar_url} size={14} />
                      Erstellt von {task.group_task_creator_name}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Trennlinie + Untergruppe-Zeile */}
            {isGroupMember && (task.subgroup_id || isGroupAdmin) && (
              <div className="task-detail-subgroup-row">
                <div className="task-detail-subgroup-row-connector">
                  <span className="task-detail-subgroup-row-line" />
                </div>
                <div className="task-detail-subgroup-row-top">
                  <div className="task-detail-subgroup-head-left">
                    {task.subgroup_id
                      ? <span className="task-detail-subgroup-dot" style={{ '--subgroup-color': task.subgroup_color || '#8E8E93' }} />
                      : <span className="task-detail-subgroup-dot is-empty" />}
                    <span className="task-detail-subgroup-title">
                      {task.subgroup_id
                        ? <><span className="task-detail-subgroup-label">Untergruppe: </span><strong>{task.subgroup_name}</strong></>
                        : <span className="task-detail-subgroup-label">Keine Untergruppe</span>}
                    </span>
                  </div>
                  {isGroupAdmin && (
                    <button type="button" onClick={() => setShowSubgroupPicker((s) => !s)} className="task-detail-subgroup-action">
                      {task.subgroup_id ? 'Ändern' : '+ Zuweisen'}
                    </button>
                  )}
                </div>

                {/* Admin: Untergruppe-Picker */}
                <AnimatePresence>
                  {isGroupAdmin && showSubgroupPicker && (
                    <motion.div className="task-detail-subgroup-picker-wrap" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                      <div className="task-detail-subgroup-picker">
                        {task.subgroup_id && (
                          <button type="button" className="task-detail-subgroup-option is-clear"
                            disabled={subgroupSaving}
                            onClick={() => handleSubgroupChange(null)}>
                            <span className="task-detail-subgroup-option-label">Keine Untergruppe</span>
                            <span className="task-edit-perm-btn" style={{ marginLeft: 'auto' }}>Entfernen</span>
                          </button>
                        )}
                        {groupSubgroups.map((sg) => (
                          <button key={sg.id} type="button"
                            className={`task-detail-subgroup-option ${String(task.subgroup_id) === String(sg.id) ? 'selected' : ''}`}
                            disabled={subgroupSaving || String(task.subgroup_id) === String(sg.id)}
                            onClick={() => handleSubgroupChange(sg.id)}>
                            <span className="task-detail-subgroup-option-dot" style={{ '--subgroup-color': sg.color || '#8E8E93' }} />
                            <span className="task-detail-subgroup-option-name">{sg.name}</span>
                            {Array.isArray(sg.members) && <span className="task-detail-subgroup-option-meta">{sg.members.length} Mitgl.</span>}
                            {String(task.subgroup_id) !== String(sg.id) && <span className="task-edit-perm-btn add" style={{ marginLeft: 'auto', flexShrink: 0 }}>Auswählen</span>}
                          </button>
                        ))}
                        {groupSubgroups.length === 0 && (
                          <span className="task-detail-subgroup-empty">Keine Untergruppen vorhanden</span>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Mitgliederliste der aktuellen Untergruppe */}
                {task.subgroup_id && Array.isArray(task.subgroup_members) && task.subgroup_members.length > 0 && (
                  <>
                    <button type="button" className="task-detail-shared-stack-wrap"
                      style={{ background: 'none', border: 'none' }}
                      onClick={() => setShowSubgroupList((s) => !s)}>
                      <div className="task-detail-shared-avatars">
                        {task.subgroup_members.slice(0, 5).map((u, i) => (
                          <span key={i} className="task-detail-shared-avatar" style={{ zIndex: 10 - i, marginLeft: i > 0 ? -10 : 0 }} title={u.name}>
                            <AvatarBadge name={u.name} color={u.avatar_color || '#007AFF'} avatarUrl={u.avatar_url} size={26} />
                          </span>
                        ))}
                        {task.subgroup_members.length > 5 && <span className="task-detail-shared-overflow">+{task.subgroup_members.length - 5}</span>}
                      </div>
                      <span className="task-detail-shared-count">
                        {task.subgroup_members.length} Mitglied{task.subgroup_members.length === 1 ? '' : 'er'}
                        <ChevronDown size={13} className={`task-detail-subgroup-chevron${showSubgroupList ? ' open' : ''}`} />
                      </span>
                    </button>
                    <AnimatePresence>
                      {showSubgroupList && (
                        <motion.div className="task-detail-subgroup-list-wrap" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                          <div className="task-detail-subgroup-list">
                            {task.subgroup_members.map((u, i) => (
                              <div key={i} className="task-detail-subgroup-member-row">
                                <AvatarBadge name={u.name} color={u.avatar_color || '#007AFF'} avatarUrl={u.avatar_url} size={26} />
                                <span className="task-detail-subgroup-member-name">{u.name}</span>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {!isMobile && task.group_id && task.enable_group_rsvp === true && isGroupMember && renderVoteSection()}

        <div className="task-detail-section task-detail-comments-section">
          <div className="task-detail-description-header">
            <MessageCircle size={16} /><span>Kommentare</span>
          </div>
          <div className="task-detail-comments-box">
            {comments.length === 0 ? (
              <div className="task-detail-comments-empty">Noch keine Kommentare</div>
            ) : comments.map((c) => (
              <div key={c.id} className="task-detail-comment-item">
                <div className="task-detail-comment-top">
                  <AvatarBadge
                    className="task-detail-comment-avatar"
                    name={c.author || 'Nutzer'}
                    color={c.author_color || '#8E8E93'}
                    avatarUrl={c.author_avatar_url}
                    size={20}
                  />
                  <span className="task-detail-comment-author">{c.author}</span>
                  <span className="task-detail-comment-time">{format(parseISO(c.created_at), 'd. MMM, HH:mm', { locale: de })}</span>
                  {currentUser?.id === c.user_id && (
                    <button type="button" className="task-detail-comment-delete" onClick={async () => {
                      try {
                        await api.deleteComment(c.id);
                        setComments((prev) => prev.filter((item) => item.id !== c.id));
                        addToast('Kommentar gelöscht');
                      } catch { addToast('Kommentar konnte nicht gelöscht werden'); }
                    }} title="Löschen"><Trash2 size={14} /></button>
                  )}
                </div>
                <div className="task-detail-comment-text">{c.text}</div>
              </div>
            ))}
          </div>
          <div className="task-detail-comment-input-wrap">
            <div className="task-detail-comment-row">
              <button type="button" className="task-detail-emoji-picker-btn" onClick={() => setShowEmojiPicker(!showEmojiPicker)} title="Emoji einfügen">😊</button>
              <input className="task-detail-comment-input" placeholder="Kommentar schreiben..." value={commentText} onChange={(e) => setCommentText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleAddComment(); }} />
              <button type="button" className="task-detail-comment-send" onClick={handleAddComment}><Send size={14} /></button>
            </div>
            {showEmojiPicker && (
              <div ref={emojiPickerRef} className="task-detail-emoji-picker">
                {['💬', '👍', '✅', '🔥', '🙏', '🎉', '📌', '🤝'].map((emoji) => (
                  <button key={emoji} type="button" className="task-detail-emoji-btn" onClick={() => { setCommentText(commentText + emoji); setShowEmojiPicker(false); }} title={emoji}>{emoji}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );

  const editPortal = showEdit && createPortal(
    <Suspense fallback={null}>
      <TaskEditModal
        task={task}
        onClose={() => setShowEdit(false)}
        onSaved={(updatedTask) => {
          fetchTasks({ dashboard: 'true', limit: '300', horizon_days: '42', completed_lookback_days: '30' }, { force: true });
          onUpdated?.(updatedTask);
          onClose();
        }}
      />
    </Suspense>,
    document.body
  );

  const deleteChoicePortal = (
    <DeleteTaskChoiceModal
      open={deleteChoiceOpen}
      onClose={() => setDeleteChoiceOpen(false)}
      taskTitle={task?.title}
      taskType={task?.type}
      canFullDelete={(isOwnerResolved || isGroupAdminTask) && !String(task?.id || '').startsWith('v_')}
      isOwner={isOwnerResolved}
      onFullDelete={() => { deleteTask(task.id, { mode: 'full' }); onClose(); }}
      onDismiss={() => { deleteTask(task.id, { mode: 'dismiss' }); onClose(); }}
    />
  );

  const sharePortal = shareSheetOpen && createPortal(
    <Suspense fallback={null}>
      <ShareTaskSheet
        task={task}
        open={shareSheetOpen}
        onClose={() => setShareSheetOpen(false)}
      />
    </Suspense>,
    document.body
  );

  // Verknuepfte Notiz direkt im Vollbild-Editor oeffnen (statt zur NotesPage zu navigieren).
  const openedNote = openNoteId != null
    ? (Array.isArray(notesAll) ? notesAll.find((n) => String(n.id) === String(openNoteId)) : null)
    : null;
  const openedNoteIsForeign = !!openedNote && !!currentUserId && String(openedNote.user_id) !== currentUserId;
  const noteEditorPortal = openedNote && createPortal(
    <NoteEditorModal
      note={openedNote}
      readOnly={openedNoteIsForeign}
      onClose={() => setOpenNoteId(null)}
      onUpdate={async (id, updates) => { try { await updateNoteStore(id, updates); } catch (e) { console.error(e); } }}
      onDelete={async (id) => {
        if (!window.confirm('Notiz wirklich loeschen?')) return;
        try { await deleteNoteStore?.(id); setOpenNoteId(null); } catch (e) { console.error(e); }
      }}
      onComplete={async (id) => { try { await completeNoteStore?.(id); setOpenNoteId(null); } catch (e) { console.error(e); } }}
    />,
    document.body
  );

  if (pageMode) {
    return <>{content}{editPortal}{deleteChoicePortal}{sharePortal}{noteEditorPortal}</>;
  }

  // Mobile/tablet: render directly into body — no overlay wrapper
  // This ensures position:fixed works relative to viewport (not a stacking context)
  if (isMobile) {
    return (
      <>
        {createPortal(
          <AnimatePresence>{content}</AnimatePresence>,
          document.body
        )}
        {editPortal}
        {deleteChoicePortal}
        {sharePortal}
        {noteEditorPortal}
      </>
    );
  }

  // Desktop: classic centered overlay modal
  return (
    <>
      <AnimatePresence>
        <motion.div
          className="modal-overlay task-detail-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          {content}
        </motion.div>
      </AnimatePresence>
      {editPortal}
      {deleteChoicePortal}
      {sharePortal}
      {noteEditorPortal}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────
// Verknuepfte Notizen (bidirektional). Liest notes aus dem Store,
// filtert nach linked_task_id, erlaubt Anheften via inline-Picker.
// Click auf Notiz-Chip oeffnet die Notiz im NoteEditorModal (auf der
// NotesPage). Falls man nicht dort ist, navigiert ?openNote=ID.
// ─────────────────────────────────────────────────────────────────
const NOTE_COLOR_MAP = {
  Gelb: '#E6D35C', Blau: '#5DADE2', 'Grün': '#58D68D', Gruen: '#58D68D',
  Rosa: '#F1948A', Orange: '#F39C12', Lila: '#BB8FCE',
};
function parseNoteMeta(content) {
  const raw = content || '';
  const m = raw.match(/^\[COLOR:([^\]]+)\]\s*/);
  const accent = m ? (NOTE_COLOR_MAP[m[1]] || '#E6D35C') : '#E6D35C';
  const rest = m ? raw.slice(m[0].length) : raw;
  const snippet = rest.replace(/^[#>\-*`\s]+/g, '').slice(0, 60);
  return { accent, snippet };
}

function LinkedNotesSection({ task, notesAll, updateNoteStore, onOpenNote, pickerOpen, setPickerOpen, pickerQuery, setPickerQuery, currentUserId }) {
  const linkedNotes = useMemo(() => {
    if (!Array.isArray(notesAll) || !task?.id) return [];
    return notesAll.filter((n) => n && String(n.linked_task_id || '') === String(task.id));
  }, [notesAll, task?.id]);

  const availableNotes = useMemo(() => {
    if (!Array.isArray(notesAll)) return [];
    const q = pickerQuery.trim().toLowerCase();
    return notesAll
      // Nur eigene Notes, die noch nicht an die aktuelle Task gehaengt sind,
      // koennen via Picker angeheftet werden — fremde Team-Notes bleiben aussen vor.
      .filter((n) => n && (!currentUserId || String(n.user_id) === String(currentUserId)))
      .filter((n) => n && String(n.linked_task_id || '') !== String(task?.id || ''))
      .filter((n) => !q || (n.title || '').toLowerCase().includes(q) || (n.content || '').toLowerCase().includes(q))
      .slice(0, 30);
  }, [notesAll, pickerQuery, task?.id, currentUserId]);

  const isTaskCreator = !!currentUserId && !!task?.user_id && String(task.user_id) === String(currentUserId);

  const handleAttach = async (noteId) => {
    try {
      await updateNoteStore(noteId, { linked_task_id: task.id });
      setPickerOpen(false);
      setPickerQuery('');
    } catch (err) {
      console.error('[TaskDetailModal] attach note failed:', err);
    }
  };
  const handleDetach = async (noteId, e) => {
    e?.stopPropagation();
    try { await updateNoteStore(noteId, { linked_task_id: null }); } catch (err) { console.error(err); }
  };
  const handleOpenNote = (note) => {
    // Notiz direkt im Vollbild-Editor oeffnen (statt zur NotesPage zu navigieren).
    try { onOpenNote?.(note.id); } catch (err) { console.error(err); }
  };

  const ownerInitials = (note) => {
    const src = note.owner_name || '';
    if (!src) return '?';
    const parts = src.trim().split(/\s+/).filter(Boolean);
    const init = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('');
    return init || '?';
  };

  return (
    <div className="task-detail-section task-detail-notes-section">
      <div className="task-detail-description-header">
        <StickyNote size={16} />
        <span>Notizen</span>
        {linkedNotes.length > 0 && <span className="task-detail-notes-count">{linkedNotes.length}</span>}
      </div>

      {linkedNotes.length > 0 && (
        <div className="task-detail-notes-list">
          {linkedNotes.map((note) => {
            const meta = parseNoteMeta(note.content);
            const isOwn = !currentUserId || String(note.user_id) === String(currentUserId);
            const isShared = note.visibility === 'group';
            const canDetach = isOwn || isTaskCreator;
            const chipClasses = [
              'task-detail-note-chip',
              !isOwn ? 'task-detail-note-chip--foreign' : '',
              isOwn && !isShared ? 'task-detail-note-chip--private' : '',
              isOwn && isShared ? 'task-detail-note-chip--shared' : '',
            ].filter(Boolean).join(' ');
            return (
              <button
                key={note.id}
                type="button"
                className={chipClasses}
                style={{ '--note-accent': meta.accent }}
                onClick={() => handleOpenNote(note)}
                title={isOwn ? 'Notiz oeffnen' : `Notiz von ${note.owner_name || 'Teammitglied'} ansehen`}
              >
                <span className="task-detail-note-chip-stripe" aria-hidden="true" />
                {!isOwn ? (
                  <span className="task-detail-note-chip-avatar" aria-hidden="true" title={note.owner_name || ''}>
                    {note.owner_avatar_url ? (
                      <img src={note.owner_avatar_url} alt="" />
                    ) : (
                      <span>{ownerInitials(note)}</span>
                    )}
                  </span>
                ) : (
                  <span className="task-detail-note-chip-badge" aria-hidden="true">
                    {isShared ? <Users size={12} /> : <Lock size={12} />}
                  </span>
                )}
                <span className="task-detail-note-chip-body">
                  <span className="task-detail-note-chip-title">{note.title || 'Ohne Titel'}</span>
                  {meta.snippet && <span className="task-detail-note-chip-snippet">{meta.snippet}</span>}
                </span>
                {canDetach && (
                  <span
                    className="task-detail-note-chip-remove"
                    role="button"
                    tabIndex={0}
                    onClick={(e) => handleDetach(note.id, e)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleDetach(note.id, e); } }}
                    title={isOwn ? 'Verknuepfung loesen' : 'Notiz von dieser Task entfernen (Moderation)'}
                    aria-label="Verknuepfung loesen"
                  >
                    <Link2Off size={13} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="task-detail-notes-add-wrap">
        <button
          type="button"
          className="task-detail-notes-add"
          onClick={() => setPickerOpen((v) => !v)}
          aria-expanded={pickerOpen}
        >
          <Link2 size={14} /> <span>{linkedNotes.length > 0 ? 'Weitere Notiz anheften' : 'Notiz anheften'}</span>
        </button>
        {createPortal(
          <AnimatePresence>
            {pickerOpen && (
              <motion.div
                key="task-detail-notes-picker-backdrop"
                className="task-detail-notes-picker-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                onClick={() => { setPickerOpen(false); setPickerQuery(''); }}
              >
                <motion.div
                  className="task-detail-notes-picker"
                  role="listbox"
                  initial={{ opacity: 0, y: 12, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.97 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="task-detail-notes-picker-search">
                    <Search size={13} />
                    <input
                      type="text"
                      placeholder="Notiz suchen…"
                      value={pickerQuery}
                      onChange={(e) => setPickerQuery(e.target.value)}
                      autoFocus={typeof window !== 'undefined' && !window.matchMedia('(max-width: 720px)').matches}
                    />
                    <button
                      type="button"
                      className="task-detail-notes-picker-close"
                      onClick={() => { setPickerOpen(false); setPickerQuery(''); }}
                      aria-label="Schliessen"
                    >×</button>
                  </div>
                  <div className="task-detail-notes-picker-list">
                    {availableNotes.length === 0 ? (
                      <div className="task-detail-notes-picker-empty">Keine Notizen gefunden.</div>
                    ) : availableNotes.map((n) => {
                      const meta = parseNoteMeta(n.content);
                      return (
                        <button
                          key={n.id}
                          type="button"
                          className="task-detail-notes-picker-item"
                          onClick={() => handleAttach(n.id)}
                          role="option"
                        >
                          <span className="task-detail-notes-picker-dot" style={{ background: meta.accent }} aria-hidden="true" />
                          <span className="task-detail-notes-picker-title">{n.title || 'Ohne Titel'}</span>
                          {meta.snippet && <span className="task-detail-notes-picker-snippet">{meta.snippet}</span>}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
      </div>
    </div>
  );
}
