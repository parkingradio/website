import { describe, expect, it } from 'vitest'
import { soundCloudStandIn } from './soundcloud-stand-in.js'
import { PREVIEW_SUFFIX, STAND_IN_TRACKS } from './stand-in-tracks.js'

describe('the stand-in for SoundCloud', () => {
  it('accepts any credentials, and shows no playlist and gives no streams', async () => {
    expect(await soundCloudStandIn.checkCredentials()).toBe(true)
    expect(await soundCloudStandIn.resolvePlaylist('https://soundcloud.com/parkingdotradio/sets/rotation')).toBeNull()
    await expect(soundCloudStandIn.playlist('1', null)).rejects.toThrow()
    await expect(soundCloudStandIn.hlsStream('1', null)).rejects.toThrow()
  })

  it('shows the tracks it knows as they are on SoundCloud', async () => {
    for (const { link, id, durationMs } of STAND_IN_TRACKS) {
      expect(await soundCloudStandIn.resolveTrack(link)).toBe(id)
      expect(await soundCloudStandIn.readTrack(link, id)).toEqual({ state: 'playable', durationMs, secretToken: null })
    }
  })

  it('makes up the same id and length for a link each time, and for its private link, from 40 to 90 minutes', async () => {
    const link = 'https://soundcloud.com/parkingdotradio/made-up'
    const id = await soundCloudStandIn.resolveTrack(link)
    expect(id).toMatch(/^\d+$/)
    expect(await soundCloudStandIn.resolveTrack(`${link}/s-AbC123`)).toBe(id)
    expect(await soundCloudStandIn.resolveTrack('https://soundcloud.com/parkingdotradio/made-up-too')).not.toBe(id)
    const read = await soundCloudStandIn.readTrack(link, id!)
    expect(read).toEqual(await soundCloudStandIn.readTrack(`${link}/s-AbC123`, id!))
    expect(read.state).toBe('playable')
    expect(read.durationMs! % 1000).toBe(0)
    expect(read.durationMs).toBeGreaterThanOrEqual(40 * 60 * 1000)
    expect(read.durationMs).toBeLessThan(90 * 60 * 1000)
  })

  it('only lets a preview be played of a track whose name ends with its suffix', async () => {
    const link = `https://soundcloud.com/parkingdotradio/extrait${PREVIEW_SUFFIX}`
    const id = (await soundCloudStandIn.resolveTrack(link))!
    expect((await soundCloudStandIn.readTrack(link, id)).state).toBe('preview')
  })

  it("shows no track at a link that leads to another one than the set's", async () => {
    const [{ link }] = STAND_IN_TRACKS
    expect(await soundCloudStandIn.readTrack(link, '1')).toEqual({ state: 'missing', durationMs: null, secretToken: null })
  })
})
