/**
 * Converts SVG data to a Data URI for use in CSS
 * @param svgData The raw SVG markup
 * @returns A data URI string that can be used in CSS
 */
export function svgToDataUri(svgData: string): string {
    try {
        // Remove any newlines and extra spaces
        let cleanedSvg = svgData.replace(/\s+/g, ' ').trim();

        // Handle SVGs from common sites that wrap content in groups
        if (cleanedSvg.includes('SVGRepo')) {
            // Extract the actual icon content from SVGRepo's wrapper groups
            const iconCarrierMatch = cleanedSvg.match(/<g id="SVGRepo_iconCarrier">(.*?)<\/g>/);
            if (iconCarrierMatch) {
                cleanedSvg = iconCarrierMatch[1].trim();
                // Wrap back in svg tag with necessary attributes
                cleanedSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${cleanedSvg}</svg>`;
            }
        }

        // Replace specific fill colors with currentColor for theme compatibility
        cleanedSvg = cleanedSvg
            .replace(/fill="#[0-9A-Fa-f]{3,6}"/g, 'fill="currentColor"')
            .replace(/fill="black"/g, 'fill="currentColor"')
            .replace(/fill="none"/g, '')
            .replace(/fill="white"/g, 'fill="currentColor"');

        // URI encode the SVG
        const encodedSvg = encodeURIComponent(cleanedSvg)
            .replace(/'/g, '%27')
            .replace(/"/g, '%22');

        // Create the data URI
        return `data:image/svg+xml,${encodedSvg}`;
    } catch (error) {
        console.error('SVG processing error:', error, '\nOriginal SVG:', svgData);
        throw error;
    }
}

/**
 * Checks if a string is an emoji using a more comprehensive detection method
 * @param str The string to check
 * @returns boolean indicating if the string is an emoji
 */
export function isEmoji(str: string): boolean {
    const trimmed = str.trim();
    // This regex pattern matches most emoji sequences, including:
    // - Single unicode emojis
    // - Emoji with modifiers (skin tones)
    // - Emoji with variation selectors
    // - Emoji ZWJ sequences
    const emojiPattern = /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*$/u;
    return emojiPattern.test(trimmed);
}

/**
 * Generates CSS for the JOTS callout icon
 * @param sectionName The name of the JOTS section (used in the callout data-callout attribute)
 * @param svgData The SVG icon data
 * @param labelColor The color of the label
 * @returns The CSS string for styling the callout icon
 */
export function generateJotsIconCss(sectionName: string, svgData: string, labelColor: string): string {
    const dataUri = svgToDataUri(svgData);
    return `.callout[data-callout="${sectionName.toLowerCase()}"] {
    --callout-color: ${labelColor};
    --callout-title-color: ${labelColor};
    margin: 0;
    padding: 0;
    position: relative;
}
.callout[data-callout="${sectionName.toLowerCase()}"] > .callout-title {
    color: ${labelColor};
    margin: 0;
    padding: 0;
}
.callout[data-callout="${sectionName.toLowerCase()}"] > .callout-title > .callout-title-inner {
    color: ${labelColor};
}
.callout[data-callout="${sectionName.toLowerCase()}"] > .callout-content {
    margin: 0;
    padding: 0 0 0 1em;
    position: relative;
}
.callout[data-callout="${sectionName.toLowerCase()}"] .callout-content blockquote {
    margin: 0;
    padding: 0;
    border: none;
}
.callout[data-callout="${sectionName.toLowerCase()}"] > .callout-title > .callout-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 17px;
    height: 17px;
}
.callout[data-callout="${sectionName.toLowerCase()}"] > .callout-title > .callout-icon > svg {
    mask-image: url("${dataUri}");
    -webkit-mask-image: url("${dataUri}");
    mask-repeat: no-repeat;
    -webkit-mask-repeat: no-repeat;
    mask-size: contain;
    -webkit-mask-size: contain;
    mask-position: center;
    -webkit-mask-position: center;
    background-color: currentColor;
    width: 100%;
    height: 100%;
}`;
}