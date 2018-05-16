'use strict';

// Load external modules
const Fs = require('fs');
const Hoek = require('hoek');
const Items = require('items');
const Joi = require('joi');
const Juice = require('juice');
const Nodemailer = require('nodemailer');
const NodemailerPluginInlineBase64 = require('nodemailer-plugin-inline-base64');
const Path = require('path');

// Declare internals
const internals = {};

internals.defaults = {
    views: {
        engines: {}
    },
    inlineImages: true,
    inlineStyles: true
};

internals.schema = Joi.object({
    transport: Joi.object(),
    views: Joi.object(),
    inlineImages: Joi.boolean(),
    inlineStyles: Joi.boolean()
});

const pkg = require("../package");

exports.plugin = {
    name: pkg.name,
    version: pkg.version,
    pkg: pkg,
    once: true,
    multiple: false,
    register: function (server, options/*: OptionsI*/) {

        Joi.assert(options, internals.schema);
        const config = Hoek.applyToDefaultsWithShallow(internals.defaults, options, ['views']);

        const transport = Nodemailer.createTransport(config.transport);

        if (config.inlineImages) {
            transport.use('compile', NodemailerPluginInlineBase64);
        }

        // server.dependency('vision', (server, done) => {
        if (Object.keys(config.views.engines).length) {
            server.views(config.views);
        }

        server.expose('sendMail',
            async (data) => {
                let promise = new Promise(
                    (resolve, reject) => {
                        Items.parallel(['text', 'html'], (format, cb) => {
                            const path = typeof data[format] === 'object' ? data[format].path : '';
                            const extension = Path.extname(path).substr(1);

                            if (config.views.engines.hasOwnProperty(extension)) {
                                server.render(path, data.context, (err, rendered) => {
                                    if (err) return cb(err);

                                    if (format === 'html' && config.inlineStyles) {
                                        data[format] = Juice(rendered); // eslint-disable-line new-cap
                                    } else {
                                        data[format] = rendered;
                                    }

                                    return cb();
                                });
                            } else {
                                if (typeof data[format] !== 'object') {
                                    return cb();
                                }

                                Fs.readFile(path, 'utf8', (err, rendered) => {
                                    if (err) return cb(err);

                                    data[format] = rendered;
                                    return cb();
                                });
                            }
                        }, (err) => {
                            if (err) return reject(err);

                            delete data.context;
                            transport.sendMail(
                                data,
                                (err, info) => {
                                    server.log("debug", info);
                                    if (err) {
                                        return reject(err)
                                    }

                                    return resolve(info);
                                }
                            );
                        });
                    }
                );

                return promise;
            }
        );
    }
};