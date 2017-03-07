import Component from 'ember-component';
import layout from '../../templates/components/markdown-card';
import {formatMarkdown} from '../../lib/format-markdown';
import injectService from 'ember-service/inject';
import {invokeAction} from 'ember-invoke-action';
import {isEmberArray} from 'ember-array/utils';
import {isBlank} from 'ember-utils';
import computed from 'ember-computed';
import observer from 'ember-metal/observer';
import run from 'ember-runloop';
import {
    isRequestEntityTooLargeError,
    isUnsupportedMediaTypeError,
    isVersionMismatchError,
    UnsupportedMediaTypeError
} from 'ghost-admin/services/ajax';
/* legacyConverter.makeHtml(_.toString(this.get('markdown'))) */

export default Component.extend({
    layout,
    isEditing: true,
    accept: 'image/gif,image/jpg,image/jpeg,image/png,image/svg+xml',
    extensions: ['gif', 'jpg', 'jpeg', 'png', 'svg'],

    ajax: injectService(),

    editing: observer('isEditing', function () {
        if (!this.isEditing) {
            this.set('preview', formatMarkdown([this.get('payload').markdown]));
        }
    }),

    value: computed('payload', {
        get() {
            return this.get('payload').markdown || '';
        },

        set(_, value) {
            this.get('payload').markdown = value;
            this.get('env').save(this.get('payload'), false);
            return value;
        }

    }),

    _uploadStarted() {
        invokeAction(this, 'uploadStarted');
    },

    _uploadProgress(event) {
        if (event.lengthComputable) {
            run(() => {
                let percentage = Math.round((event.loaded / event.total) * 100);
                this.set('uploadPercentage', percentage);
            });
        }
    },

    _uploadFinished() {
        invokeAction(this, 'uploadFinished');
    },

    _uploadSuccess(response) {
        this.set('url', response.url);

        this.get('payload').img = response.url;
        this.get('env').save(this.get('payload'), false);

        this.send('saveUrl');
        this.send('reset');
        invokeAction(this, 'uploadSuccess', response);
        let placeholderText = `![uploading:${response.file.name}]()`;
        let imageText = `![](${response.url})`;
        let [el] = this.$('textarea');

        el.value = el.value.replace(placeholderText, imageText);
        this.sendAction('updateValue');
    },

    _validate(file) {
        if (this.get('validate')) {
            return invokeAction(this, 'validate', file);
        } else {
            return this._defaultValidator(file);
        }
    },

    _uploadFailed(error) {
        let message;

        if (isVersionMismatchError(error)) {
            this.get('notifications').showAPIError(error);
        }

        if (isUnsupportedMediaTypeError(error)) {
            message = 'The image type you uploaded is not supported. Please use .PNG, .JPG, .GIF, .SVG.';
        } else if (isRequestEntityTooLargeError(error)) {
            message = 'The image you uploaded was larger than the maximum file size your server allows.';
        } else if (error.errors && !isBlank(error.errors[0].message)) {
            message = error.errors[0].message;
        } else {
            message = 'Something went wrong :(';
        }

        this.set('failureMessage', message);
        invokeAction(this, 'uploadFailed', error);
        alert('upload failed');
        // TODO: remove console.log
        // eslint-disable-next-line no-console
        console.log(error);
    },

    _defaultValidator(file) {
        let extensions = this.get('extensions');
        let [, extension] = (/(?:\.([^.]+))?$/).exec(file.name);

        if (!isEmberArray(extensions)) {
            extensions = extensions.split(',');
        }

        if (!extension || extensions.indexOf(extension.toLowerCase()) === -1) {
            return new UnsupportedMediaTypeError();
        }

        return true;
    },

    generateRequest() {
        let ajax = this.get('ajax');
        // let formData = this.get('formData');

        let file = this.get('file');
        let formData = new FormData();
        formData.append('uploadimage', file);

        let url = `${this.get('apiRoot')}/uploads/`;
        this._uploadStarted();

        ajax.post(url, {
            data: formData,
            processData: false,
            contentType: false,
            dataType: 'text',
            xhr: () => {
                let xhr = new window.XMLHttpRequest();

                xhr.upload.addEventListener('progress', (event) => {
                    this._uploadProgress(event);
                }, false);

                // TODO: remove console.logs
                /* eslint-disable no-console */
                xhr.addEventListener('error', (event) => console.log('error', event));
                xhr.upload.addEventListener('error', (event) => console.log('errorupload', event));
                /* eslint-enabled no-console */

                return xhr;
            }
        }).then((response) => {
            let url = JSON.parse(response);
            this._uploadSuccess({file, url});
        }).catch((error) => {
            this._uploadFailed(error);
        }).finally(() => {
            this._uploadFinished();
        });
    },

    drop(event) {
        event.preventDefault();
        event.stopPropagation();
        let [el] = this.$('textarea');
        let start = el.selectionStart;
        let end = el.selectionEnd;

        let {files} = event.dataTransfer;
        let combinedLength = 0;
        // for(let i = 0; i < files.length; i++) {
        //     let file = files[i];
        //     let placeholderText = `\r\n![uploading:${file.name}]()\r\n`;
        //     el.value = el.value.substring(0, start) + placeholderText + el.value.substring(end, el.value.length);
        //     combinedLength += placeholderText.length;
        // }

        // eslint-disable-next-line ember-suave/prefer-destructuring
        let file = files[0];
        let placeholderText = `\r\n![uploading:${file.name}]()\r\n`;
        el.value = el.value.substring(0, start) + placeholderText + el.value.substring(end, el.value.length);
        combinedLength += placeholderText.length;

        el.selectionStart = start;
        el.selectionEnd = end + combinedLength;

        this.send('fileSelected', event.dataTransfer.files);
    },

    actions: {
        updateValue() {
            this.get('payload').markdown = this.$('textarea').val();
            this.get('env').save(this.get('payload'), false);
            this.set('preview', formatMarkdown([this.get('payload').markdown]));
        },

        fileSelected(fileList) {
            // can't use array destructuring here as FileList is not a strict
            // array and fails in Safari
            // eslint-disable-next-line ember-suave/prefer-destructuring
            let file = fileList[0];

            // jscs:enable requireArrayDestructuring
            let validationResult = this._validate(file);

            this.set('file', file);

            invokeAction(this, 'fileSelected', file);

            if (validationResult === true) {
                run.schedule('actions', this, function () {
                    this.generateRequest();
                });
            } else {
                this._uploadFailed(validationResult);
            }
        },

        reset() {
            this.set('file', null);
            this.set('uploadPercentage', 0);
        },

        saveUrl() {
            let url = this.get('url');
            invokeAction(this, 'update', url);
        }
    }

});
