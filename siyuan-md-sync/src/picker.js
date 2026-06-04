import { Dialog } from 'siyuan';
import { t } from './i18n.js';

function inputDialog(title, message, placeholder = '') {
  return new Promise((resolve) => {
    const dialog = new Dialog({
      title,
      content: `<div class="b3-dialog__content">
  <div>${message}</div>
  <div class="fn__hr"></div>
  <input class="b3-text-field fn__block" placeholder="${placeholder}" />
</div>
<div class="b3-dialog__action">
  <button class="b3-button b3-button--cancel">${t('cancel')}</button><div class="fn__space"></div>
  <button class="b3-button b3-button--text">${t('confirm')}</button>
</div>`,
      width: '520px',
    });
    const input = dialog.element.querySelector('input');
    const [cancelBtn, confirmBtn] = dialog.element.querySelectorAll('.b3-button');
    setTimeout(() => input.focus(), 0);
    dialog.bindInput(input, () => confirmBtn.click());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cancelBtn.click();
    });
    cancelBtn.addEventListener('click', () => { dialog.destroy(); resolve(null); });
    confirmBtn.addEventListener('click', () => {
      const v = input.value.trim();
      dialog.destroy();
      resolve(v || null);
    });
  });
}

export async function pickDirectory() {
  return inputDialog(t('addFolderTitle'), t('addFolderPrompt'), '/Users/me/notes');
}

export async function pickFile() {
  return inputDialog(t('pickAFileTitle'), t('pickAFilePrompt'), '/Users/me/notes/foo.md');
}
