# Rotation radio

At `/admin/rotation`: the radio's rotation of sets, in the order they come on air, and changing it (see
[The rotation of sets](../../server/radio.md#the-rotation-of-sets)). The playlist the radio plays until it switches to
the rotation is chosen in [Rotation radio (legacy)](rotation-legacy.md).

## The rotation

Under the title, the page says which admin last changed the rotation, and when, e.g. « Modifiée par admin@example.com
le 5 octobre 2026 à 23 h 30. », once it's been changed. Until the credentials of the SoundCloud app have been entered,
a line says that the radio can't read any track on SoundCloud until then, and links to
[Configuration](configuration.md), where they're entered.

The sets are listed in the order they come on air: from the one on air, marked « en cours », around the rotation, each
one once. Each set that isn't skipped shows when it goes on air, or, for the set on air, when it went on air, with the
day before it whenever it changes, as on [Rotation radio (legacy)](rotation-legacy.md). Each set shows its performers,
each linking to their page, its session's title and day (see [Names, in Sessions](sessions.md#names)), linking to the
session's page, its track's length once it's been read, e.g. « 1 h 02 », and links to its track and its video, named
« SoundCloud » and « YouTube ».

Skipped sets stay in their place, faded out, without a time, and say why, in French, for each of their reasons (see
[Which sets](../../server/radio.md#which-sets)). When the last read of a set's track failed, the set has a warning (see
[Warnings](layout.md#warnings)) that says why, as the server says it, and, unless it was never read, that the radio goes
on with what was read before.

When the rotation is empty, the page says « La rotation est vide : la radio est hors ondes. » When every set of the
rotation is skipped, it says that no set can be played, so that the radio is off air, and lists the sets in the
rotation's order, without times. When the rotation can't be loaded, the page says why in place of the list, without
« modifier ».

Even while the rotation is being changed, the page loads it again when the set on air ends, a couple of seconds after
it, though never sooner than 10 seconds after it was last loaded, so that a browser whose clock is ahead doesn't load it
again and again, and when the browser's tab is shown again, at most once a minute. When it can't be loaded again, the
page goes on showing what it loaded last, and says why above it.

## Changing the rotation

« modifier » turns the list into one that can be changed, in the order it's shown, from the set on air: each set
numbered, with a handle that moves it (see [Reordering](layout.md#reordering)) and a « × » that takes it out, like a
set's performers (see [A set's form, in Sessions](sessions.md#a-sets-form)). The set on air is still marked
« en cours », and skipped sets still say why, but times aren't shown, since they'd change with the order.

Under the list, « Ajouter un set » adds a set at the end of it, and keeps the focus, so that several can be added one
after the other. It offers the sets that can be added (see
[`GET /api/admin/radio/rotation/candidates`](../../server/radio.md#get-apiadminradiorotationcandidates-admin)), loaded
when « modifier » is clicked, the most recent session first, then those taken out of the list since then, whatever they
are, since a set that's already in the rotation can stay in it (see
[`PUT /api/admin/radio/rotation`](../../server/radio.md#put-apiadminradiorotation-admin)). Each one is named by its
performers, with its session's title and day, and they're searched (see [Searching lists](layout.md#searching-lists)) by
their performers, their session's title, and its day, written out (e.g. "samedi 14 novembre 2026"). A line under the
field says which sets can be added. When they can't be loaded, the field can't be used, and the page says why.

« annuler » leaves the rotation as it is. « enregistrer » only closes the list when it's as it was shown when
« modifier » was clicked. Otherwise, it asks to confirm, next to it rather than in a dialog, with a sentence that says
what saving does to what's on air (see [On air](../../server/radio.md#on-air)), the first of these that applies: that
the radio will be off air, when the rotation would be empty, or when every set in it would be skipped, the sets added
counting as ones that can be played, since saving reads their tracks; that it will come back on air right away, when it's
off air; that it will go on to the next set right away, when the set on air is taken out; or else that the set on air
goes on, and the changes apply from the next one, e.g. « Le set en cours continue : les changements s'appliquent dès le
set suivant. ». Then come « confirmer », and « revenir », which goes back to changing the list. The rotation is saved in the
order shown, so that the set on air comes first in the rotation's order, which changes nothing that's played. Whatever
was saved in the meantime, e.g. by another admin, is replaced. While the page asks to confirm, and while the rotation is
sent, which can take several seconds, since the server reads the tracks of the sets added, the list can't be changed,
and while it's sent, the button reads « enregistrement… ».

Once it's saved, the page shows the rotation as the server returns it, and says « La rotation a été enregistrée. »
When it can't be saved, the list stays as it was being changed, and the page says why: for a set that can't be added,
which one, and why, e.g. « Le set de Aurore (HAUTE RIVE TAKEOVER, sam. 14 nov. 2026) ne peut pas être ajouté à la
rotation : la session n'est pas annoncée. », in which case the sets that can be added are loaded again; for a set that
no longer exists, which one; or else the server's error.

## Endpoints

- `GET /api/admin/radio/rotation`, for the rotation.
- `GET /api/admin/radio/credentials`, for whether the credentials of the SoundCloud app have been entered.
- `GET /api/admin/radio/rotation/candidates`, for the sets that can be added.
- `PUT /api/admin/radio/rotation`, to save it.
