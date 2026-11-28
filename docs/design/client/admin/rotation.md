# Rotation radio

At `/admin/rotation`: the radio's rotation of sets, in the order they come on air, and changing it (see
[The rotation of sets](../../server/radio.md#the-rotation-of-sets)). The playlist the radio plays until it switches to
the rotation is chosen in [Rotation radio (legacy)](rotation-legacy.md).

## The rotation

The page says which admin last changed the rotation, and when, once one has. Until the credentials of the SoundCloud app
have been entered, a line says that the radio can't read any track until then, and links to
[Configuration](configuration.md), where they're entered.

The sets are listed in the order they come on air, as the server gives them, from the play head (see
[On air](../../server/radio.md#on-air)): the one on air, marked « en cours », first. Like the legacy page's tracks, each
set that isn't skipped shows when it begins, with the day whenever it changes. Each set shows its performers and its
session's title and day (see [Names, in Sessions](sessions.md#names)), linking to their pages, its track's length once
it's been read, and its "SoundCloud" and "YouTube" links.

Skipped sets stay in their place, faded out, without a time, and say why (see
[Which sets](../../server/radio.md#which-sets)). When the last read of a set's track failed, the set has a warning (see
[Warnings](layout.md#warnings)) that says why, and, unless it was never read, that the radio goes on with what was read
before.

When the rotation is empty, or every set in it is skipped, the page says so, and that the radio is off air. When the
rotation can't be loaded, the page says why in place of the list, without « modifier ».

The page loads the rotation again shortly after the set on air ends, though never sooner than several seconds after it
last loaded it, so that a browser whose clock is ahead doesn't load it again and again, and when the browser's tab is
shown again, at most once a minute. It does so even while the rotation is being changed, which leaves the list being
changed as it is, but can change what saving it says it does. When it can't be loaded again, the page goes on showing
what it loaded last, and says why above it.

## Changing the rotation

« modifier » turns the list, in the order shown, into one that can be changed like a set's performers (see
[A set's form, in Sessions](sessions.md#a-sets-form)): numbered, with handles that move the sets (see
[Reordering](layout.md#reordering)), and a « × » that takes one out. Its first set that isn't skipped is marked
« en ondes », since it's the one on air once the list is saved, so that moving another set first puts it on air, and the
other sets that aren't skipped « à suivre ». The sets added count as ones that can be played, since saving reads their
tracks. It says why sets are skipped, with their warnings, but without times.

Under the list, « Ajouter un set » adds a set at the end of it, and keeps the focus. It offers the sets that can be
added (see
[`GET /api/admin/radio/rotation/candidates`](../../server/radio.md#get-apiadminradiorotationcandidates-admin)), then
those taken out of the list since « modifier » was clicked, even skipped ones, since a set already in the rotation can
stay in it (see [`PUT /api/admin/radio/rotation`](../../server/radio.md#put-apiadminradiorotation-admin)). They're
named with their session (see [Names, in Sessions](sessions.md#names)), and searched (see
[Searching lists](layout.md#searching-lists)) by their performers and their session's title and day. A line under the
field says which sets can be added. When they can't be loaded, the field can't be used, and the page says why.

« annuler » leaves the rotation as it is, and so does « enregistrer » when the list is as it was when « modifier » was
clicked. Otherwise, « enregistrer » asks to confirm, in a dialog on the page rather than the browser's, with
« confirmer », and « revenir », which, like Escape, goes back to changing the list, and a sentence that says what saving does to what's on air (see
[On air](../../server/radio.md#on-air)), the first of these that applies:

- The radio will be off air: the rotation would be empty, or every set in it skipped.
- It will come back on air right away, with the set marked « en ondes »: it's off air.
- The set on air goes on, and the changes apply from the next set: it's the set marked « en ondes ».
- The set marked « en ondes » will go on air right away, in place of the set on air.

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
- `PUT /api/admin/radio/rotation`, to save it.
