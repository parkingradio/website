import type { Discord } from './discord.js'

// What the server uses in place of Discord with CHAT_STAND_IN, e.g. in development and in tests, so that nothing reaches
// Discord (see "The chat" in the README). It accepts any credentials, which the routes have checked the format of.
export const discordStandIn: Discord = {
  async check() {
    return { botName: 'stand-in', channelName: 'chat' }
  },
}
