import type { RawEnvelope } from '../../src/signal/envelopes'

export const SELF = 'self-uuid'

export const inboundText: RawEnvelope = {
  envelope: {
    sourceUuid: 'alice-uuid',
    sourceNumber: '+15551110001',
    timestamp: 1000,
    dataMessage: { message: 'hello from alice', timestamp: 1000 },
  },
}

export const ownSentText: RawEnvelope = {
  envelope: {
    sourceUuid: SELF,
    timestamp: 2000,
    syncMessage: {
      sentMessage: {
        destination: 'alice-uuid',
        destinationNumber: '+15551110001',
        message: 'reply from my phone',
        timestamp: 2000,
      },
    },
  },
}

export const groupText: RawEnvelope = {
  envelope: {
    sourceUuid: 'bob-uuid',
    sourceNumber: '+15551110002',
    timestamp: 3000,
    dataMessage: { message: 'hi group', timestamp: 3000, groupInfo: { groupId: 'group-xyz' } },
  },
}

export const inboundReaction: RawEnvelope = {
  envelope: {
    sourceUuid: 'alice-uuid',
    timestamp: 3100,
    dataMessage: {
      timestamp: 3100,
      reaction: { emoji: '👍', targetAuthor: SELF, targetSentTimestamp: 2000, isRemove: false },
    },
  },
}

export const ownSentReaction: RawEnvelope = {
  envelope: {
    sourceUuid: SELF,
    timestamp: 4100,
    syncMessage: {
      sentMessage: {
        timestamp: 4100,
        reaction: { emoji: '🎉', targetAuthor: 'alice-uuid', targetSentTimestamp: 1000, isRemove: false },
      },
    },
  },
}

export const remoteDelete: RawEnvelope = {
  envelope: {
    sourceUuid: 'alice-uuid',
    timestamp: 3200,
    dataMessage: { timestamp: 3200, remoteDelete: { timestamp: 1000 } },
  },
}

export const editMessage: RawEnvelope = {
  envelope: {
    sourceUuid: 'alice-uuid',
    timestamp: 3300,
    editMessage: { targetSentTimestamp: 1000, dataMessage: { message: 'hello (edited)' } },
  },
}

export const ownSentEdit: RawEnvelope = {
  envelope: {
    sourceUuid: SELF,
    timestamp: 4200,
    syncMessage: {
      sentMessage: {
        timestamp: 4200,
        editMessage: { targetSentTimestamp: 2000, dataMessage: { message: 'reply from my phone (edited)' } },
      },
    },
  },
}

export const readReceipt: RawEnvelope = {
  envelope: {
    sourceUuid: 'alice-uuid',
    sourceNumber: '+15551110001',
    timestamp: 3400,
    receiptMessage: { isRead: true, timestamps: [2000] },
  },
}

export const typing: RawEnvelope = {
  envelope: { sourceUuid: 'alice-uuid', timestamp: 3500, typingMessage: { action: 'STARTED' } },
}
