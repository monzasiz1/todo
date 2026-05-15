import { motion, AnimatePresence } from 'framer-motion';
import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useTaskStore } from '../store/taskStore';
import { useGroupStore } from '../store/groupStore';
import { useOpenTask } from '../hooks/useOpenTask';
// TaskDetailModal ist gross und nur sichtbar, wenn der User eine Karte
// oeffnet - lazy ausgliedern, um das Initial-Bundle zu verkleinern.
const TaskDetailModal = lazy(() => import('./TaskDetailModal'));
import { Check, Trash2, Clock, Calendar, CalendarCheck, GripVertical, Lock, Users, UserCheck, Repeat, Paperclip, Video, Circle, ThumbsDown, MapPin, Pencil, Share2 } from 'lucide-react';
import { format, parseISO, isToday, isTomorrow, isPast } from 'date-fns';
import { de } from 'date-fns/locale';
import SharedTaskBadge from './SharedTaskBadge';
import AvatarBadge from './AvatarBadge';
import DeleteTaskChoiceModal from './DeleteTaskChoiceModal';
const ShareTaskSheet = lazy(() => import('./ShareTaskSheet'));

function TaskCard({ task, index, disableLayout = false, showDashboardDateTile = false, showSharedInfo = true }) {
  // Selektiv abonnieren: Actions sind stabil und aendern sich nie -
  // ohne Selector wuerde jeder Store-Change (z.B. anderer Task) ein
  // Re-Render aller TaskCards triggern und das memo() wirkungslos machen.
  const toggleTask = useTaskStore((s) => s.toggleTask);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const { detailTask, openTask, closeTask } = useOpenTask();
  const [nowTs, setNowTs] = useState(Date.now());
  const shouldAnimate = index < 10 && !disableLayout;
  const touchDragRef = useRef({
    active: false,
    timer: null,
    startX: 0,
    startY: 0,
  });

  // Swipe-to-reveal (mobile): nach links wischen, um Aktionen freizulegen
  const SWIPE_ACTIONS_WIDTH = 156; // Spurbreite der floating Icon-Chips
  const [swipeX, setSwipeX] = useState(0);
  const [swipeOpen, setSwipeOpen] = useState(false);
  const [swipeArmed, setSwipeArmed] = useState(false); // Apple-Style: voll durchgezogen → sofort löschen
  const swipeStateRef = useRef({ startX: 0, startY: 0, startOffset: 0, isSwipe: false, decided: false, wrapWidth: 0, armed: false });
  const swipeWrapRef = useRef(null);
  const [shareOpen, setShareOpen] = useState(false);

  const formatDate = (dateStr) => {
    if (!dateStr) return null;
    const date = parseISO(dateStr);
    const now = new Date();
    if (isToday(date)) return 'Heute';
    if (isTomorrow(date)) return 'Morgen';
    // Wenn Jahr unterschiedlich, Jahr anzeigen
    if (date.getFullYear() !== now.getFullYear()) {
      return format(date, 'd. MMM yyyy', { locale: de });
    }
    return format(date, 'd. MMM', { locale: de });
  };

  const formatTime = (timeStr) => {
    if (!timeStr) return null;
    const [h, m] = timeStr.split(':');
    return `${h}:${m} Uhr`;
  };

  const getDashboardDateParts = (dateStr) => {
    if (!dateStr) return null;
    const date = parseISO(String(dateStr));
    if (Number.isNaN(date.getTime())) return null;
    return {
      month: format(date, 'MMM', { locale: de }).replace('.', '').toUpperCase(),
      day: format(date, 'd', { locale: de }),
    };
  };

  const getEventEndDate = (t) => {
    if (!t?.date) return null;
    const datePart = String(t.date).slice(0, 10);
    const rawEnd = String(t.time_end || t.time || '23:59').slice(0, 5);
    const parts = rawEnd.split(':');
    const hh = String(Math.min(23, Math.max(0, Number(parts[0]) || 23))).padStart(2, '0');
    const mm = String(Math.min(59, Math.max(0, Number(parts[1]) || 59))).padStart(2, '0');
    const end = new Date(`${datePart}T${hh}:${mm}:00`);
    return Number.isNaN(end.getTime()) ? null : end;
  };

  const priorityColors = {
    low: 'var(--success)',
    medium: 'var(--primary)',
    high: 'var(--warning)',
    urgent: 'var(--danger)',
  };

  const isEvent = task.type === 'event';
  const eventEndAt = isEvent ? getEventEndDate(task) : null;
  const isEventEnded = isEvent && !!eventEndAt && eventEndAt.getTime() < nowTs;
  // Beendete Termine sind nicht überfällig – nur offene Aufgaben (keine Events) werden rot markiert
  const isOverdue = task.date && !task.completed && isPast(parseISO(task.date)) && !isToday(parseISO(task.date)) && !isEventEnded;
  const currentUserId = useMemo(() => {
    try {
      const u = JSON.parse(localStorage.getItem('user') || 'null');
      const id = Number(u?.id);
      return Number.isFinite(id) ? id : null;
    } catch {
      return null;
    }
  }, []);
  const isOwnerResolved = (() => {
    const ownerId = Number(task?.user_id);
    if (Number.isFinite(ownerId) && Number.isFinite(currentUserId)) {
      return ownerId === currentUserId;
    }
    return task?.is_owner === true;
  })();
  const canEdit = !isOwnerResolved
    ? (task.can_edit === true || (!!task.group_id && (task.is_group_member === true || (task.is_group_member === undefined && task.my_group_role != null))))
    : true;

  // Admin-Erkennung: bevorzugt aus task.my_group_role (wenn vom Endpoint geliefert),
  // sonst Fallback auf groupStore.groups (jede Gruppe enthält das eigene `role`).
  const groupsFromStore = useGroupStore((s) => s.groups);
  const isGroupAdmin = (() => {
    if (isOwnerResolved || !task.group_id) return false;
    if (task.my_group_role === 'owner' || task.my_group_role === 'admin') return true;
    const grp = (groupsFromStore || []).find((g) => String(g.id) === String(task.group_id));
    return grp?.role === 'owner' || grp?.role === 'admin';
  })();

  const [deleteChoiceOpen, setDeleteChoiceOpen] = useState(false);

  const handleDeleteClick = () => {
    // Owner ODER Gruppen-Admin → Wahldialog (Komplett löschen vs Aus meinem Kalender)
    // Alle anderen (Member, Freund mit Freigabe) → direkt aus dem Kalender entfernen
    if (isOwnerResolved || isGroupAdmin) {
      setDeleteChoiceOpen(true);
    } else {
      deleteTask(task.id, { mode: 'dismiss' });
    }
  };
  const canShareToChat = !!task.group_id && !(isEvent && isEventEnded);
  const shortTitle = String(task.title || 'Termin').slice(0, 32);
  const timeLabel = task.time ? `${String(task.time).slice(0, 5)} Uhr` : '';
  const hasGroupCategoryCombo = (!!task.group_name || !!task.group_id) && !!task.group_category_name;
  const isSharedGroupTask = !!task.group_id && !isOwnerResolved;
  // Gruppen-Badge verstecken wenn Nutzer kein Gruppenmitglied ist (weitergeleitet oder direktgeteilt)
  const isGroupMemberResolved = task.is_group_member === true || (task.is_group_member === undefined && task.my_group_role != null);
  const hideGroupBadge = !isOwnerResolved && !isGroupMemberResolved;
  // Weitergeleitet = direkte Freigabe ohne Gruppe (kein Gruppen-Badge anzeigen)
  const isForwardedTask = !task.group_id && !isOwnerResolved;
  const dashboardDateParts = showDashboardDateTile ? getDashboardDateParts(task.date) : null;
  const useDashboardDateRail = Boolean(showDashboardDateTile && dashboardDateParts);

  useEffect(() => {
    return () => {
      if (touchDragRef.current.timer) clearTimeout(touchDragRef.current.timer);
    };
  }, []);

  // Native non-passive touchmove-Listener: garantiert, dass preventDefault()
  // beim horizontalen Wischen wirklich greift (React's onTouchMove ist passiv
  // und ignoriert preventDefault). Ohne diesen Listener scrollt der Browser
  // manchmal die Seite mitten in der Swipe-Geste weg → Swipe „funktioniert"
  // dann zufällig.
  useEffect(() => {
    const el = swipeWrapRef.current;
    if (!el) return undefined;
    const onMoveNative = (e) => {
      if (swipeStateRef.current.isSwipe && e.cancelable) {
        e.preventDefault();
      }
    };
    el.addEventListener('touchmove', onMoveNative, { passive: false });
    return () => el.removeEventListener('touchmove', onMoveNative);
  }, []);

  useEffect(() => {
    let mounted = true;
    let intervalId = null;
    let timeoutId = null;

    const syncNow = () => { if (mounted) setNowTs(Date.now()); };
    const startMinuteAlignedTicker = () => {
      const msToNextMinute = 60000 - (Date.now() % 60000) + 30;
      timeoutId = setTimeout(() => {
        syncNow();
        intervalId = setInterval(syncNow, 60000);
      }, msToNextMinute);
    };

    const onVisibilityOrFocus = () => syncNow();

    startMinuteAlignedTicker();
    window.addEventListener('focus', onVisibilityOrFocus);
    document.addEventListener('visibilitychange', onVisibilityOrFocus);

    return () => {
      mounted = false;
      if (timeoutId) clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
      window.removeEventListener('focus', onVisibilityOrFocus);
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);
    };
  }, []);

  const dispatchShareEvent = (name, detail = {}) => {
    window.dispatchEvent(new CustomEvent(name, {
      detail: {
        taskId: task.id,
        groupId: task.group_id,
        title: shortTitle,
        time: timeLabel,
        ...detail,
      },
    }));
  };

  const startTouchDrag = () => {
    touchDragRef.current.active = true;
    dispatchShareEvent('task-share-drag-start', { source: 'touch' });
  };

  const endTouchDrag = (clientX, clientY) => {
    const el = document.elementFromPoint(clientX, clientY);
    const droppedOnChat = !!el?.closest('.gchat-dropzone');
    dispatchShareEvent('task-share-touch-drop', { droppedOnChat });
    dispatchShareEvent('task-share-drag-end', { source: 'touch', droppedOnChat });
    touchDragRef.current.active = false;
  };

  const handleDragStart = (e) => {
    if (!canShareToChat) return;
    e.dataTransfer.setData('application/x-task-id', String(task.id));
    if (task.group_id) {
      e.dataTransfer.setData('application/x-task-group-id', String(task.group_id));
    }
    e.dataTransfer.effectAllowed = 'copy';

    // Compact drag preview instead of dragging the whole task card screenshot.
    const ghost = document.createElement('div');
    ghost.className = 'task-share-native-ghost';
    ghost.innerHTML = `<span class="dot"></span><span class="txt">${shortTitle}${timeLabel ? ` · ${timeLabel}` : ''}</span>`;
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 16, 16);
    setTimeout(() => ghost.remove(), 0);

    dispatchShareEvent('task-share-drag-start', { source: 'mouse', x: e.clientX, y: e.clientY });
  };

  const handleDrag = (e) => {
    if (!canShareToChat) return;
    if (e.clientX === 0 && e.clientY === 0) return;
    const over = !!document.elementFromPoint(e.clientX, e.clientY)?.closest('.gchat-dropzone');
    dispatchShareEvent('task-share-drag-move', { source: 'mouse', x: e.clientX, y: e.clientY, over });
    dispatchShareEvent('task-share-drag-hover', { over });
  };

  const handleDragEnd = () => {
    if (!canShareToChat) return;
    dispatchShareEvent('task-share-drag-end', { source: 'mouse' });
  };

  const handleTouchStart = (e) => {
    const t = e.touches?.[0];
    if (t) {
      touchDragRef.current.startX = t.clientX;
      touchDragRef.current.startY = t.clientY;
      const wrapW = swipeWrapRef.current ? swipeWrapRef.current.getBoundingClientRect().width : 320;
      swipeStateRef.current = {
        startX: t.clientX,
        startY: t.clientY,
        startOffset: swipeX,
        isSwipe: false,
        decided: false,
        wrapWidth: wrapW,
        armed: false,
      };
    }
    if (!canShareToChat) return;
    if (touchDragRef.current.timer) clearTimeout(touchDragRef.current.timer);
    touchDragRef.current.timer = setTimeout(() => {
      if (!swipeStateRef.current.isSwipe) startTouchDrag();
    }, 180);
  };

  const handleTouchMove = (e) => {
    const t = e.touches?.[0];
    if (!t) return;
    const dx = t.clientX - swipeStateRef.current.startX;
    const dy = t.clientY - swipeStateRef.current.startY;

    // Richtung entscheiden (einmal) — niedrige Schwelle, damit Lock-In schnell
    // passiert und der Browser keine Zeit hat, vertikales Scrollen zu starten.
    if (!swipeStateRef.current.decided && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
      swipeStateRef.current.decided = true;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 4) {
        // Horizontale Geste → Swipe-Aktionen, Chat-Drag verhindern
        swipeStateRef.current.isSwipe = true;
        if (touchDragRef.current.timer) {
          clearTimeout(touchDragRef.current.timer);
          touchDragRef.current.timer = null;
        }
      }
    }

    if (swipeStateRef.current.isSwipe) {
      e.preventDefault?.();
      const next = swipeStateRef.current.startOffset + dx;
      const wrapW = swipeStateRef.current.wrapWidth || 320;
      // Erlaubt voll durchzuziehen bis fast komplett aus dem Bildschirm
      const clamped = Math.max(-wrapW, Math.min(30, next));
      setSwipeX(clamped);
      // Apple-Style: bei ≥ 60% Spurbreite "armed" → visuelle Bestätigung, dass Löschen ausgelöst wird
      const commitDist = Math.max(220, wrapW * 0.6);
      const nowArmed = -clamped >= commitDist;
      if (nowArmed !== swipeStateRef.current.armed) {
        swipeStateRef.current.armed = nowArmed;
        setSwipeArmed(nowArmed);
        // Haptisches Feedback (sofern verfügbar) genau am Schwellenübergang
        if (nowArmed && typeof navigator !== 'undefined' && navigator.vibrate) {
          try { navigator.vibrate(12); } catch (_) { /* noop */ }
        }
      }
      return;
    }

    // bestehender Chat-Drag-Move
    if (touchDragRef.current.timer) {
      const movedEnough =
        Math.abs(t.clientX - touchDragRef.current.startX) > 8 ||
        Math.abs(t.clientY - touchDragRef.current.startY) > 8;
      if (movedEnough && !touchDragRef.current.active) {
        clearTimeout(touchDragRef.current.timer);
        touchDragRef.current.timer = null;
      }
    }

    if (!touchDragRef.current.active) return;
    e.preventDefault();
    const over = !!document.elementFromPoint(t.clientX, t.clientY)?.closest('.gchat-dropzone');
    dispatchShareEvent('task-share-drag-hover', { over });
    dispatchShareEvent('task-share-drag-move', { source: 'touch', x: t.clientX, y: t.clientY, over });
  };

  const handleTouchEnd = (e) => {
    if (touchDragRef.current.timer) {
      clearTimeout(touchDragRef.current.timer);
      touchDragRef.current.timer = null;
    }
    // Swipe-Geste abschliessen
    if (swipeStateRef.current.isSwipe) {
      const wrapW = swipeStateRef.current.wrapWidth || 320;
      // Apple-Style: voll durchgezogen → sofort löschen
      if (swipeStateRef.current.armed) {
        // Karte ganz raus animieren, dann Delete triggern
        setSwipeX(-wrapW);
        setSwipeOpen(false);
        swipeStateRef.current.isSwipe = false;
        setTimeout(() => {
          handleDeleteClick();
          // Zurücksetzen für den Fall, dass der User im Choice-Modal abbricht
          setTimeout(() => {
            setSwipeArmed(false);
            swipeStateRef.current.armed = false;
            setSwipeX(0);
          }, 220);
        }, 200);
        return;
      }
      // Breite an Viewport anpassen (muss zu CSS unten passen)
      const targetWidth = (typeof window !== 'undefined' && window.innerWidth <= 380) ? 140 : SWIPE_ACTIONS_WIDTH;
      const threshold = targetWidth / 2.4;
      if (swipeX < -threshold) {
        setSwipeX(-targetWidth);
        setSwipeOpen(true);
      } else {
        setSwipeX(0);
        setSwipeOpen(false);
      }
      setSwipeArmed(false);
      swipeStateRef.current.armed = false;
      swipeStateRef.current.isSwipe = false;
      return;
    }
    if (!touchDragRef.current.active) return;
    const t = e.changedTouches?.[0];
    if (!t) return;
    endTouchDrag(t.clientX, t.clientY);
  };

  const closeSwipe = () => { setSwipeX(0); setSwipeOpen(false); };
  const handleCardClick = (e) => {
    if (swipeOpen) {
      e.stopPropagation();
      closeSwipe();
      return;
    }
    openTask(task);
  };
  const handleSwipeShare = (e) => {
    e.stopPropagation();
    closeSwipe();
    setShareOpen(true);
  };
  const handleSwipeEdit = (e) => {
    e.stopPropagation();
    closeSwipe();
    openTask(task);
  };
  const handleSwipeDelete = (e) => {
    e.stopPropagation();
    closeSwipe();
    handleDeleteClick();
  };

  return (
    <>
    <div
      ref={swipeWrapRef}
      className={`task-card-swipe-wrap${swipeOpen ? ' open' : ''}${!swipeOpen && swipeX < -4 ? ' swiping' : ''}${swipeArmed ? ' armed' : ''}`}
      style={{ '--task-overpull': `${Math.max(0, -swipeX - SWIPE_ACTIONS_WIDTH)}px` }}
    >
      <div
        className="task-card-swipe-track"
        style={{ transform: `translate3d(${swipeX}px, 0, 0)` }}
      >
    <motion.div
      className={`task-card ${isEvent ? 'event' : 'todo'} ${task.completed ? 'completed' : ''} ${canShareToChat ? 'can-share-chat' : ''} ${isEventEnded ? 'ended-event' : ''}`}
      draggable={canShareToChat}
      onDragStart={handleDragStart}
      onDrag={handleDrag}
      onDragEnd={handleDragEnd}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      layout={!disableLayout}
      initial={shouldAnimate ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -100, height: 0, marginBottom: 0, padding: 0 }}
      transition={shouldAnimate ? { duration: 0.18, delay: index * 0.01 } : { duration: 0.18 }}
      onClick={handleCardClick}
      style={{
        cursor: 'pointer',
        '--task-priority-color': priorityColors[task.priority] || priorityColors.medium,
        touchAction: 'pan-y',
      }}
      title={isEventEnded ? 'Termin beendet' : (canShareToChat ? 'In den Gruppen-Chat ziehen' : undefined)}
    >
      {/* Priority Bar */}
      <div
        className={`task-card-priority ${task.priority}`}
        style={{ background: priorityColors[task.priority] }}
      />

      {/* Dashboard Date Tile — first flex item so it can be flush to card edge */}
      {dashboardDateParts && (
        <div className={`task-dashboard-date ${isEvent ? 'event' : 'todo'}${useDashboardDateRail ? ' has-marker' : ''}`} aria-hidden="true">
          {isEvent ? (
            <span className="task-dashboard-date-icon">
              <CalendarCheck size={12} />
            </span>
          ) : (
            <button
              type="button"
              className={`task-dashboard-date-toggle ${task.completed ? 'checked' : ''} ${!canEdit ? 'disabled' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                if (canEdit) toggleTask(task.id);
              }}
              aria-label={task.completed ? 'Aufgabe wieder öffnen' : 'Aufgabe erledigen'}
            >
              {task.completed ? <Check size={14} strokeWidth={3} /> : <Circle size={14} strokeWidth={2.5} />}
            </button>
          )}
          <span className="task-dashboard-date-month">{dashboardDateParts.month}</span>
          <span className="task-dashboard-date-day">{dashboardDateParts.day}</span>
        </div>
      )}

      {/* Drag Handle — absolute corner tab, only for sharable group items */}
      {canShareToChat && (
        <div
          className="task-drag-handle task-drag-handle--corner"
          onClick={(e) => e.stopPropagation()}
          title="Verschieben"
          aria-hidden="true"
        >
          <GripVertical size={14} />
        </div>
      )}

      {/* Checkbox / Event Icon — only when no date tile */}
      {!useDashboardDateRail && isEvent ? (
        <div className="task-event-icon" title="Termin">
          <CalendarCheck size={18} />
        </div>
      ) : (
        !useDashboardDateRail && !isEvent && showDashboardDateTile && (
          /* Datumlose Aufgabe im Dashboard: Badge-Pill mit Abhakenknopf, ohne Datum */
          <div className="task-dashboard-date todo no-date" aria-hidden="true">
            <button
              type="button"
              className={`task-dashboard-date-toggle ${task.completed ? 'checked' : ''} ${!canEdit ? 'disabled' : ''}`}
              onClick={(e) => { e.stopPropagation(); if (canEdit) toggleTask(task.id); }}
              aria-label={task.completed ? 'Aufgabe wieder öffnen' : 'Aufgabe erledigen'}
            >
              {task.completed ? <Check size={14} strokeWidth={3} /> : <Circle size={14} strokeWidth={2.5} />}
            </button>
          </div>
        )
      )}
      {/* Fallback-Checkbox außerhalb des Dashboards */}
      {!useDashboardDateRail && !isEvent && !showDashboardDateTile && (
        <motion.div
          className={`task-checkbox ${task.completed ? 'checked' : ''} ${!canEdit ? 'disabled' : ''}`}
          onClick={(e) => { e.stopPropagation(); if (canEdit) toggleTask(task.id); }}
          whileTap={canEdit ? { scale: 0.85 } : {}}
        >
          {task.completed && <Check size={14} strokeWidth={3} />}
        </motion.div>
      )}

      {/* Content */}
      <div className="task-content">
        <div className="task-title-row">
          <div className="task-title">{task.title}</div>
          {!isEvent && <span className="task-type-badge task">Aufgabe</span>}
          {isEvent && <span className="task-type-badge event">Termin</span>}
          {task.teams_join_url && <span className="task-type-badge teams"><Video size={10} /> Teams</span>}
          {isEventEnded && <span className="task-type-badge ended">Beendet</span>}
        </div>
        {task.description && !isSharedGroupTask && (
          <div className="task-description-preview">
            {task.description.length > 60 ? task.description.substring(0, 60) + '…' : task.description}
          </div>
        )}
        {showSharedInfo && <SharedTaskBadge task={task} />}
        {hasGroupCategoryCombo && !hideGroupBadge && (
          <span
            className="task-group-combo-badge"
            style={{
              background: `linear-gradient(to right, ${(task.group_color || '#5856D6')}28 0%, ${(task.group_category_color || '#8E8E93')}30 100%)`,
              borderColor: `${task.group_color || '#5856D6'}55`,
            }}
          >
            <AvatarBadge
              name={task.group_name}
              color={task.group_color || '#5856D6'}
              avatarUrl={task.group_image_url}
              size={10}
            />
            {task.group_name && <span className="task-group-combo-name" style={{ color: task.group_color || '#5856D6' }}>{task.group_name}</span>}
            <span className="task-group-combo-cat" style={{ color: task.group_category_color || '#636366' }}>
              <span
                className="task-group-category-dot"
                style={{ background: task.group_category_color || '#8E8E93' }}
              />
              {task.group_category_name}
            </span>
          </span>
        )}
        {task.group_name && !hasGroupCategoryCombo && !hideGroupBadge && (
          <span
            className="task-group-badge"
            style={{
              background: task.group_color ? `${task.group_color}18` : 'rgba(88,86,214,0.1)',
              color: task.group_color || '#5856D6',
            }}
          >
            <AvatarBadge
              name={task.group_name}
              color={task.group_color || '#5856D6'}
              avatarUrl={task.group_image_url}
              size={12}
            />
            {task.group_name}
          </span>
        )}
        {task.group_category_name && !hasGroupCategoryCombo && !hideGroupBadge && (
          <span
            className="task-group-category-badge"
            style={{
              background: task.group_category_color ? `${task.group_category_color}22` : 'rgba(142,142,147,0.12)',
              color: task.group_category_color || '#636366',
              borderColor: task.group_category_color ? `${task.group_category_color}55` : 'rgba(142,142,147,0.3)',
            }}
          >
            <span
              className="task-group-category-dot"
              style={{ background: task.group_category_color || '#8E8E93' }}
            />
            {task.group_category_name}
          </span>
        )}
        {task.subgroup_id && !hideGroupBadge && (
          <span className="task-subgroup-badge" title={`Untergruppe: ${task.subgroup_name || ''}`} style={{ background: task.subgroup_color ? `${task.subgroup_color}18` : 'rgba(88,86,214,0.08)', borderColor: task.subgroup_color ? `${task.subgroup_color}44` : 'rgba(88,86,214,0.2)' }}>
            <Lock size={10} />
            <span style={{ fontSize: 11, fontWeight: 600 }}>{task.subgroup_name || 'Untergruppe'}</span>
            {Array.isArray(task.subgroup_members) && task.subgroup_members.length > 0 && (
              <span className="task-subgroup-avatars">
                {task.subgroup_members.slice(0, 4).map((m) => (
                  <AvatarBadge key={m.user_id} name={m.name} color={m.avatar_color || '#007AFF'} avatarUrl={m.avatar_url} size={18} title={m.name} />
                ))}
                {task.subgroup_members.length > 4 && (
                  <span style={{ fontSize: 10, color: 'var(--text-secondary)', marginLeft: 2 }}>+{task.subgroup_members.length - 4}</span>
                )}
              </span>
            )}
          </span>
        )}
        {task.recurrence_rule && (
          <span
            className="task-group-badge"
            style={{
              background: 'rgba(0,122,255,0.1)',
              color: '#007AFF',
            }}
          >
            <Repeat size={12} />
            {{ daily: 'Täglich', weekly: 'Wöchentlich', biweekly: 'Alle 2 Wo.', monthly: 'Monatlich', yearly: 'Jährlich', weekdays: 'Werktags' }[task.recurrence_rule] || task.recurrence_rule}
          </span>
        )}
        <div className="task-meta">
          {task.date && (
            <span className="task-meta-item" style={isOverdue ? { color: 'var(--danger)' } : {}}>
              <Calendar size={14} />
              {formatDate(task.date)}{task.date_end && task.date_end !== task.date ? ` – ${formatDate(task.date_end)}` : ''}
            </span>
          )}
          {task.time && (
            <span className="task-meta-item" style={isEventEnded ? { color: 'var(--text-tertiary)' } : {}}>
              <Clock size={14} />
              {formatTime(task.time)}{task.time_end ? ` – ${formatTime(task.time_end)}` : ''}
            </span>
          )}
          {!task.time && task.date && (
            <span className="task-meta-item" style={isEventEnded ? { color: 'var(--text-tertiary)' } : {}}>
              <Clock size={14} />
              Ganztägig
            </span>
          )}
          {task.category_name && !isSharedGroupTask && (
            <span
              className="task-category-badge"
              style={{
                background: task.category_color ? `${task.category_color}18` : 'var(--primary-bg)',
                color: task.category_color || 'var(--primary)',
              }}
            >
              {task.category_name}
            </span>
          )}
          {task.attachment_count > 0 && (
            <span className="task-meta-item" style={{ color: 'var(--text-tertiary)' }}>
              <Paperclip size={12} />
              {task.attachment_count}
            </span>
          )}
          {task.location && String(task.location).trim() && (
            <span className="task-meta-item task-meta-location" title={String(task.location).trim()}>
              <MapPin size={12} />
            </span>
          )}
          {task.group_id && task.enable_group_rsvp === true && (
            <div className="task-meta-votes-row">
              <span className="task-vote-stat task-vote-stat--yes" title="Zusagen">
                <Check size={12} />
                {Number(task.vote_yes_count || 0)}
              </span>
              <span className="task-vote-stat task-vote-stat--no" title="Absagen">
                <ThumbsDown size={12} />
                {Number(task.vote_no_count || 0)}
              </span>
              <span className="task-vote-stat task-vote-stat--pending" title="Unbeantwortet">
                <Users size={12} />
                {Number(task.vote_unanswered_count || 0)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      {canEdit && (
        <div className="task-actions" onClick={(e) => e.stopPropagation()}>
          <motion.button
            className="task-action-btn delete"
            onClick={handleDeleteClick}
            whileTap={{ scale: 0.85 }}
            title={isGroupAdmin ? 'Optionen zum Entfernen' : 'Löschen'}
          >
            <Trash2 size={16} />
          </motion.button>
        </div>
      )}
    </motion.div>
      <div className="task-card-swipe-actions" aria-hidden={!swipeOpen}>
        <button type="button" className="task-swipe-action edit" onClick={handleSwipeEdit} aria-label="Bearbeiten">
          <span className="task-swipe-action-icon"><Pencil size={18} /></span>
          <span className="task-swipe-action-label">Bearbeiten</span>
        </button>
        <button type="button" className="task-swipe-action share" onClick={handleSwipeShare} aria-label="Teilen">
          <span className="task-swipe-action-icon"><Share2 size={18} /></span>
          <span className="task-swipe-action-label">Teilen</span>
        </button>
        <button type="button" className="task-swipe-action delete" onClick={handleSwipeDelete} aria-label="Löschen">
          <span className="task-swipe-action-icon"><Trash2 size={18} /></span>
          <span className="task-swipe-action-label">Löschen</span>
        </button>
      </div>
      </div>
    </div>

    <DeleteTaskChoiceModal
      open={deleteChoiceOpen}
      onClose={() => setDeleteChoiceOpen(false)}
      taskTitle={task.title}
      taskType={task.type}
      canFullDelete={(isOwnerResolved || isGroupAdmin) && !String(task.id).startsWith('v_')}
      isOwner={isOwnerResolved}
      onFullDelete={() => deleteTask(task.id, { mode: 'full' })}
      onDismiss={() => deleteTask(task.id, { mode: 'dismiss' })}
    />

    {detailTask && (
      <Suspense fallback={null}>
        <TaskDetailModal
          task={detailTask}
          onClose={closeTask}
          onUpdated={closeTask}
          hidePrivateShareInfo={!showSharedInfo}
        />
      </Suspense>
    )}

    {shareOpen && (
      <Suspense fallback={null}>
        <ShareTaskSheet
          task={task}
          open={shareOpen}
          onClose={() => setShareOpen(false)}
        />
      </Suspense>
    )}
    </>
  );
}

export default memo(TaskCard);
