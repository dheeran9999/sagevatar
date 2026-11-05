import { useState, type FormEvent } from 'react';
import type { EventForm, EventStatus, GalleryVisibility, ManagedEvent } from '../../lib/api';
import { Modal } from '../../components/Modal';
import { Select } from '../../components/Select';
import { Button, ErrorText, Field } from '../../components/ui';

const textAreaClass =
  'rounded-2xl border border-glass-border bg-ink/50 px-4 py-3 text-[15px] text-text outline-none transition placeholder:text-text-dim hover:border-glass-edge focus:border-brand-2/70';

type Errors = Partial<Record<'name' | 'eventDate' | 'startTime' | 'endTime' | 'location', string>>;

/** Create / edit an event. Required: name, date, start, end, location. */
export function EventFormDialog({
  open,
  onClose,
  event,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  /** Present when editing. */
  event?: ManagedEvent | null;
  onSubmit: (form: EventForm) => Promise<void>;
}) {
  const [name, setName] = useState(event?.name ?? '');
  const [eventDate, setEventDate] = useState(event?.eventDate ?? '');
  const [startTime, setStartTime] = useState(event?.startTime ?? '09:00');
  const [endTime, setEndTime] = useState(event?.endTime ?? '17:00');
  const [location, setLocation] = useState(event?.location ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [instructions, setInstructions] = useState(event?.instructions ?? '');
  const [visibility, setVisibility] = useState<GalleryVisibility>(
    event?.galleryVisibility ?? 'PARTICIPANTS',
  );
  const [publish, setPublish] = useState<'DRAFT' | 'UPCOMING'>('UPCOMING');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const validate = (): Errors => {
    const e: Errors = {};
    if (name.trim().length < 2) e.name = 'Enter the event name';
    if (!eventDate) e.eventDate = 'Pick the event date';
    if (!startTime) e.startTime = 'Enter a start time';
    if (!endTime) e.endTime = 'Enter an end time';
    else if (startTime && endTime <= startTime) e.endTime = 'End time must be after the start time';
    if (location.trim().length < 2) e.location = 'Enter the location';
    return e;
  };
  const errors = submitted ? validate() : {};

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError('');
    if (Object.keys(validate()).length) return;
    setBusy(true);
    try {
      await onSubmit({
        name: name.trim(),
        eventDate,
        startTime,
        endTime,
        location: location.trim(),
        description: description.trim(),
        instructions: instructions.trim(),
        galleryVisibility: visibility,
        // The browser's offset turns the entered local times into exact instants.
        timezoneOffset: new Date(`${eventDate}T${startTime}`).getTimezoneOffset(),
        ...(event ? {} : { status: publish as EventStatus }),
      });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={event ? 'Edit event' : 'New event'}
      description={event ? `${event.code}` : 'An Event ID is generated automatically.'}
      size="lg"
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label="Event details">
        <Field
          label="Event name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
          placeholder="Annual Day 2026"
          data-autofocus
          required
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Event date"
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            error={errors.eventDate}
            required
          />
          <Field
            label="Start time"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            error={errors.startTime}
            required
          />
          <Field
            label="End time"
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            error={errors.endTime}
            required
          />
        </div>
        <Field
          label="Location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          error={errors.location}
          placeholder="Hyderabad HQ, Atrium"
          required
        />
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-text-muted">Description (optional)</span>
          <textarea
            rows={2}
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={textAreaClass}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-text-muted">
            Instructions for participants (optional)
          </span>
          <textarea
            rows={2}
            maxLength={2000}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="e.g. Use corporate avatars; one photo per team."
            className={textAreaClass}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Gallery visibility"
            value={visibility}
            onChange={setVisibility}
            options={[
              { value: 'PARTICIPANTS', label: 'Shared with assigned participants' },
              { value: 'PRIVATE', label: 'Private: owner and Creators only' },
            ]}
          />
          {!event && (
            <Select
              label="Save as"
              value={publish}
              onChange={setPublish}
              options={[
                { value: 'DRAFT', label: 'Draft (only Creators see it)' },
                { value: 'UPCOMING', label: 'Published (participants notified)' },
              ]}
            />
          )}
        </div>
        <p className="text-xs text-text-dim">You can add a cover image after saving.</p>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {event ? 'Save changes' : 'Create event'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
