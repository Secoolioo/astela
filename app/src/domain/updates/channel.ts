import * as v from 'valibot';

/** Update channels. The beta channel also receives stable releases. */
export const UpdateChannelSchema = v.picklist(['stable', 'beta']);

/** An update channel. */
export type UpdateChannel = v.InferOutput<typeof UpdateChannelSchema>;
