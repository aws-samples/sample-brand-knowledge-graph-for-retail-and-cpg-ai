// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * The one image size limit the UI states and checks (tabs 1 to 3), the same number as the API's
 * `MAX_IMAGE_BYTES`: Bedrock Converse accepts images up to about 3.75 MB raw, and the browser
 * checks the file before encoding it, so 4 MB on the file is the honest single number.
 */
export const MAX_IMAGE_MB = 4;
export const MAX_IMAGE_BYTES = MAX_IMAGE_MB * 1024 * 1024;
