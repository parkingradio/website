# Rotation radio

At `/admin/rotation`: the radio's rotation of sets, in the order they come on air, and changing it (see
[The rotation of sets](../../server/radio.md#the-rotation-of-sets)). The playlist the radio plays until it switches to
the rotation is chosen in [Rotation radio (legacy)](rotation-legacy.md).

## The rotation

The page says which admin last changed the rotation, and when, once one has. Until the credentials of the SoundCloud app
have been entered, a line says that the radio can't read any track until then, and links to
[Configuration](configuration.md), where they're entered.

The sets are listed in the order they come on air, as the server gives them, from the play head (see
[On air](../../server/radio.md#on-air)), the one on air first, one per row, set apart like the rows of the admin pages'
tables. Like the legacy page's tracks, each set that isn't skipped shows when it begins, or began, for the one on air,
with the day whenever it changes. Each set shows its performers and its session's title and day (see
[Names, in Sessions](sessions.md#names)), linking to their pages, then its genres, in order, and its track's length once
it's been read, each in its column. The genres are small grey labels, which don't look like buttons, since they can't be
clicked, and which screen readers read as text, e.g. « house, techno ». Their column fits about two genres on one line,
e.g. « tech house, deep house »; more go on more lines. It's empty for a set without genres. Where the list has no room
for that column, e.g. on phones, the genres are under the session instead.

The play head is drawn across the list, over the set on air, which screen readers are told is « en ondes ». The set
under it shows how far into it the radio is, by the browser's clock: a bar, with the time played and the set's length,
e.g. « 23:14 / 55:02 », which moves on every second. Off air, there's no play head.

Skipped sets stay in their place, faded out, without a time, and say why (see
[Which sets](../../server/radio.md#which-sets)). When the last read of a set's track failed, the set has a warning (see
[Warnings](layout.md#warnings)) that says why, and, unless it was never read, that the radio goes on with what was read
before.

When the rotation is empty, or every set in it is skipped, the page says so, and that the radio is off air. When the
rotation can't be loaded, the page says why in place of the list, without « modifier ».

The page loads the rotation again shortly after the set on air ends, though never sooner than several seconds after it
last loaded it, so that a browser whose clock is ahead doesn't load it again and again, and when the browser's tab is
shown again, at most once a minute. It does so even while the rotation is being changed, which leaves the list being
changed as it is, but can change what saving it says it does, and when its sets would go on air, e.g. once the set on
air ends. When it can't be loaded again, the page goes on showing what it loaded last, and says why above it.

## Changing the rotation

« modifier » turns the list, in the order shown, into one that can be changed like a set's performers (see
[A set's form, in Sessions](sessions.md#a-sets-form)): numbered, with handles that move the sets (see
[Reordering](layout.md#reordering)), and a « × » that takes one out. Each set says its length after its session, once
its track has been read, and why it's skipped, with its warnings, and shows its genres as when the rotation isn't being
changed. Each time a set that wasn't in the rotation is added, its track is read (see
[`GET /api/admin/radio/rotation/candidates/:id`](../../server/radio.md#get-apiadminradiorotationcandidatesid-admin)):
once that answers, the set is shown as the answer says, with its length, why it's skipped, if it is, and its warning,
like the others. Until it answers, or when it can't, the set is shown as its last answer since « modifier » was clicked
said, if there's one, or else its length isn't known, and it counts as one that can be played, since saving reads its
track. The play head is over the first set that isn't skipped: saving puts that set on air (see
[On air](../../server/radio.md#on-air)), so moving another set there puts it on air. The list moves under it, rather
than it moving with a set. Its bar goes on moving when it's the set on air, and otherwise shows « 0:00 » and its length,
since saving starts it from its start, or no bar while its length isn't known. With no set that can be played, there's
no play head.

Each set that can be played shows when it would go on air once the list is saved (see
[On air](../../server/radio.md#on-air)): the set under the play head shows when it went on air, if it's the set on air,
or else now, by the browser's clock, so that the times move on with it; then each set after it that can be played shows
when the one before it ends. A set whose length isn't known shows none, and the sets after the first of these have no
time. As when the rotation isn't being changed, skipped sets have none either, and the day shows whenever it changes, on
a line of its own above the first set of that day, e.g. « dimanche 29 novembre ». The line moves with that set while it's
dragged, and is worked out again with the times once it's dropped.

Under the list, « Ajouter un set » adds a set at the end of it, and keeps the focus. It offers the sets that can be
added (see
[`GET /api/admin/radio/rotation/candidates`](../../server/radio.md#get-apiadminradiorotationcandidates-admin)), then
those taken out of the list since « modifier » was clicked, even skipped ones, since a set already in the rotation can
stay in it (see [`PUT /api/admin/radio/rotation`](../../server/radio.md#put-apiadminradiorotation-admin)). They're
named with their session (see [Names, in Sessions](sessions.md#names)), followed by their genres, if they have any, e.g.
« GUEST MIXES, ven. 16 oct. 2026 · ambient, techno », and searched (see [Searching lists](layout.md#searching-lists)) by
their performers, their session's title and day, and their genres. A line under the field says which sets can be added.
When they can't be loaded, the field can't be used, and the page says why.

« annuler » leaves the rotation as it is, and so does « enregistrer » when the list is as it was when « modifier » was
clicked. Otherwise, « enregistrer » asks to confirm, in a dialog on the page rather than the browser's, with
« confirmer », and « revenir », which, like Escape, goes back to changing the list, and a sentence that says what saving does to what's on air (see
[On air](../../server/radio.md#on-air)), the first of these that applies:

- The radio will be off air: the rotation would be empty, or every set in it skipped.
- It will come back on air right away, with the set under the play head: it's off air.
- The set on air goes on, and the changes apply from the next set: it's the set under the play head.
- The set under the play head will go on air right away, in place of the set on air.

The list is saved in the order shown, replacing whatever was saved in the meantime, e.g. by another admin. While the
page asks to confirm, and while the list is sent, it can't be changed, and while it's sent, « confirmer » reads
« enregistrement… ».

Once it's saved, the page shows the rotation as the server returns it, and says that it was saved. When it can't be
saved, the list stays as it was being changed, and the page says why: that a set can't be added, and why, or that a set
no longer exists, naming the set (see [Names, in Sessions](sessions.md#names)), or else the server's error.

## Endpoints

- `GET /api/admin/radio/rotation`, for the rotation.
- `GET /api/admin/radio/credentials`, for whether the credentials of the SoundCloud app have been entered.
- `GET /api/admin/radio/rotation/candidates`, for the sets that can be added, each time « modifier » is clicked, and
  again when saving says that a set can't be added.
- `GET /api/admin/radio/rotation/candidates/:id`, for what a set's track says of it, each time a set that wasn't in the
  rotation is added.
- `PUT /api/admin/radio/rotation`, to save it.
