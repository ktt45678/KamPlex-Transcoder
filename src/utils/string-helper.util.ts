import slugify from 'slugify';

export class StringHelper {
  divideFromString(value: string) {
    const splitValue = value.split('/');
    if (splitValue.length < 2) return 0;
    return +splitValue[0] / +splitValue[1];
  }

  trimSlugFilename(filename: string, maxLength: number = 250) {
    const slugFilename = slugify(filename, { remove: /[^0-9a-zA-Z.\-_\s]/g });
    const filenameSplit = slugFilename.split('.');
    const ext = filenameSplit.pop();
    const name = filenameSplit.join('.');
    return name.substring(0, maxLength) + '.' + ext;
  }

  escapeRegExp(text: string) {
    return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
  }
}

export const stringHelper = new StringHelper();