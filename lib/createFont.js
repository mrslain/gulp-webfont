var crypto = require('crypto');
var md5 = crypto.createHash('md5');
var _ = require('lodash');
var path = require('path');
var wf = require('./util');
var fs = require('fs');
var async = require('async');
var mkdirp = require('mkdirp');
var chalk = require('chalk');
var ttf2woff2 = require('ttf2woff2');
var ttf2eot = require('ttf2eot');

var createFont = function (options, files, allDone)  {

  //var allDone = this.async();

  /**
   * Calculate hash to flush browser cache.
   * Hash is based on source SVG files contents, task options and grunt-webfont version.
   *
   * @return {String}
   */
  function getHash() {
  	// Source SVG files contents
  	o.files.forEach(function(file) {
  		md5.update(fs.readFileSync(file, 'utf8'));
  	});

  	// Options
  	md5.update(JSON.stringify(o));

  	// grunt-webfont version
  	var packageJson = require('../package.json');
  	md5.update(packageJson.version);

  	// Templates
  	if (o.template) {
  		md5.update(fs.readFileSync(o.template, 'utf8'));
  	}
  	if (o.htmlDemoTemplate) {
  		md5.update(fs.readFileSync(o.htmlDemoTemplate, 'utf8'));
  	}

  	return md5.digest('hex');
  }

  /**
		 * Find next unused codepoint.
		 *
		 * @return {Integer}
		 */
		function getNextCodepoint() {
			while (_.includes(o.codepoints, currentCodepoint)) {
				currentCodepoint++;
			}
			return currentCodepoint;
		}

    /**
		 * Save hash to cache file.
		 *
		 * @param {String} name Task name (webfont).
		 * @param {String} target Task target name.
		 * @param {String} hash Hash.
		 */
		function saveHash(name, target, hash) {
			var filepath = getHashPath(name, target);
			mkdirp.sync(path.dirname(filepath));
			fs.writeFileSync(filepath, hash);
		}

  /**
  	 * Read hash from cache file or `null` if file don’t exist.
  	 *
  	 * @param {String} name Task name (webfont).
  	 * @param {String} target Task target name.
  	 * @return {String}
  	 */
  	function readHash(name, target) {
      var filepath = getHashPath(name, target);

      return null;
  		if (fs.existsSync(filepath)) {
  			return fs.readFileSync(filepath, 'utf8');
  		}
  		return null;
  	}

  	/**
  	 * Return path to cache file.
  	 *
  	 * @param {String} name Task name (webfont).
  	 * @param {String} target Task target name.
  	 * @return {String}
  	 */
  	function getHashPath(name, target) {
  		return path.join(o.cache, name, target, 'hash');
  	}

    /**
		 * Generate font using selected engine
		 *
		 * @param {Function} done
		 */
		function generateFont(done) {
			var engine = require('./engines/' + o.engine);
			engine(o, function(result) {
				if (result === false) {
					// Font was not created, exit
					completeTask();
					return;
				}

				if (result) {
					o = _.extend(o, result);
				}

				done();
			});
		}

    /**
		 * Converts TTF font to WOFF2.
		 *
		 * @param {Function} done
		 */
		function generateWoff2Font(done) {
			if (!has(o.types, 'woff2')) {
				done();
				return;
			}

			// Read TTF font
			var ttfFontPath = wf.getFontPath(o, 'ttf');
			var ttfFont = fs.readFileSync(ttfFontPath);

			// Remove TTF font if not needed
			if (!has(o.types, 'ttf')) {
				fs.unlinkSync(ttfFontPath);
			}

			// Convert to WOFF2
			var woffFont = ttf2woff2(ttfFont);

			// Save
			var woff2FontPath = wf.getFontPath(o, 'woff2');
			fs.writeFile(woff2FontPath, woffFont, done);
		}

    /**
       * Converts TTF font to WOFF2.
       *
       * @param {Function} done
       */
    function generateEot2Font(done) {
      if (!has(o.types, 'eot')) {
        done();
        return;
      }

      // Read TTF font
      var ttfFontPath = wf.getFontPath(o, 'ttf');
      var ttfFont = fs.readFileSync(ttfFontPath);

      // Remove TTF font if not needed
      if (!has(o.types, 'ttf')) {
        fs.unlinkSync(ttfFontPath);
      }

      // Convert to EOT
      var eotFont = ttf2eot(new Uint8Array(ttfFont));

      // Save
      var eot2FontPath = wf.getFontPath(o, 'eot');
      fs.writeFile(eot2FontPath, eotFont.buffer, done);
    }


    /**
         * Generate CSS
         *
         * @param {Function} done
         */
    function generateStylesheets(done) {
      // Convert codepoints to array of strings
      var codepoints = []
      _.each(o.glyphs, function (name) {
        codepoints.push(o.codepoints[name].toString(16))
      })
      o.codepoints = codepoints

      // Prepage glyph names to use as CSS classes
      o.glyphs = _.map(o.glyphs, classnameize)

      o.stylesheets.sort(function (a, b) {
        return a === 'css' ? 1 : -1
      }).forEach(generateStylesheet)

      done()
    }

    /**
     * Generate CSS
     *
     * @param {String} stylesheet type: css, scss, ...
     */
    function generateStylesheet(stylesheet) {
      o.relativeFontPath = normalizePath(o.relativeFontPath)

      // Generate font URLs to use in @font-face
      var fontSrcs = [[], []]
      o.order.forEach(function (type) {
        if (!has(o.types, type)) return
        wf.fontsSrcsMap[type].forEach(function (font, idx) {
          if (font) {
            fontSrcs[idx].push(generateFontSrc(type, font, stylesheet))
          }
        })
      })

      // Convert urls to strings that could be used in CSS
      var fontSrcSeparator = option(wf.fontSrcSeparators, stylesheet)
      fontSrcs.forEach(function (font, idx) {
        // o.fontSrc1, o.fontSrc2
        o['fontSrc' + (idx + 1)] = font.join(fontSrcSeparator)
      })
      o.fontRawSrcs = fontSrcs

      // Read JSON file corresponding to CSS template
      var templateJson = readTemplate(o.template, o.syntax, '.json', true)
      if (templateJson) o = _.extend(o, JSON.parse(templateJson.template))

      // Now override values with templateOptions
      if (o.templateOptions) o = _.extend(o, o.templateOptions)

      // Generate CSS
      var ext = path.extname(o.template) || '.css'  // Use extension of o.template file if given, or default to .css
      o.cssTemplate = readTemplate(o.template, o.syntax, ext)
      var cssContext = _.extend(o, {
        iconsStyles: true,
        stylesheet: stylesheet
      })

      var css = renderTemplate(o.cssTemplate, cssContext)

      // Fix CSS preprocessors comments: single line comments will be removed after compilation
      if (has(['sass', 'scss', 'less', 'styl'], stylesheet)) {
        css = css.replace(/\/\* *(.*?) *\*\//g, '// $1')
      }

      // Save file
      fs.writeFileSync(getCssFilePath(stylesheet), css)
    }

    /**
         * Generate URL for @font-face
         *
         * @param {String} type Type of font
         * @param {Object} font URL or Base64 string
         * @param {String} stylesheet type: css, scss, ...
         * @return {String}
         */
    function generateFontSrc(type, font, stylesheet) {
      var filename = template(o.fontFilename + font.ext, o)
      var fontPathVariableName = o.fontFamilyName + '-font-path'

      var url
      if (font.embeddable && has(o.embed, type)) {
        url = embedFont(path.join(o.dest, filename))
      }
      else {
        if (o.fontPathVariables && stylesheet !== 'css') {
          if (stylesheet === 'less') {
            fontPathVariableName = '@' + fontPathVariableName
            o.fontPathVariable = fontPathVariableName + ' : "' + o.relativeFontPath + '";'
          }
          else {
            fontPathVariableName = '$' + fontPathVariableName
            o.fontPathVariable = fontPathVariableName + ' : "' + o.relativeFontPath + '" !default;'
          }
          url = filename
        }
        else {
          url = o.relativeFontPath + filename
        }
        if (o.addHashes) {
          if (url.indexOf('#iefix') === -1) {  // Do not add hashes for OldIE
            // Put hash at the end of an URL or before #hash
            url = url.replace(/(#|$)/, '?' + o.hash + '$1')
          }
          else {
            url = url.replace(/(#|$)/, o.hash + '$1')
          }
        }
      }

      var src = 'url("' + url + '")'
      if (o.fontPathVariables && stylesheet !== 'css') {
        if (stylesheet === 'less') {
          src = 'url("@{' + fontPathVariableName.replace('@', '') + '}' + url + '")'
        }
        else {
          src = 'url(' + fontPathVariableName + ' + "' + url + '")'
        }
      }

      if (font.format) src += ' format("' + font.format + '")'

      return src
    }

    /**
     * Generate HTML demo page
     *
     * @param {Function} done
     */
    function generateDemoHtml(done) {
      if (!o.htmlDemo) {
        done()
        return
      }

      var context = prepareHtmlTemplateContext()

      // Generate HTML
      var demoTemplate = readTemplate(o.htmlDemoTemplate, 'demo', '.html')
      var demo = renderTemplate(demoTemplate, context)

      mkdirp(getDemoPath(), function (err) {
        if (err) {
          logger.log(err)
          return
        }
        // Save file
        fs.writeFileSync(getDemoFilePath(), demo)
        done()
      })

    }

  /*
   * Prepares base context for templates
   */
  function prepareBaseTemplateContext() {
    var context = _.extend({}, o)
    return context
  }

  /*
       * Makes custom extends necessary for use with preparing the template context
       * object for the HTML demo.
       */
  function prepareHtmlTemplateContext() {

    var context = prepareBaseTemplateContext()

    var htmlStyles

    // Prepare relative font paths for injection into @font-face refs in HTML
    var relativeRe = new RegExp(_.escapeRegExp(o.relativeFontPath), 'g')
    var htmlRelativeFontPath = normalizePath(o.dest)
    var _fontSrc1 = o.fontSrc1.replace(relativeRe, htmlRelativeFontPath)
    var _fontSrc2 = o.fontSrc2.replace(relativeRe, htmlRelativeFontPath)

    _.extend(context, {
      fontSrc1: _fontSrc1,
      fontSrc2: _fontSrc2,
      fontfaceStyles: true,
      baseStyles: true,
      extraStyles: false,
      iconsStyles: true,
      stylesheet: 'css'
    })

    // Prepares CSS for injection into <style> tag at to of HTML
    htmlStyles = renderTemplate(o.cssTemplate, context)
    _.extend(context, {
      styles: htmlStyles
    })

    return context
  }


    /**
		 * Print log
		 *
		 * @param {Function} done
		 */
		function printDone(done) {
			console.log('Font ' + chalk.cyan(o.fontName) + ' with ' + o.glyphs.length + ' glyphs created.');
			done();
		}

    /**
		 * Call callback function if it was specified in the options.
		 */
		function completeTask() {
			if (o && _.isFunction(o.callback)) {
				o.callback(o.fontName, o.types, o.glyphs, o.hash);
			}
			allDone(o);
		}


    /**
     * Return path of CSS file.
     *
     * @param {String} stylesheet (css, scss, ...)
     * @return {String}
     */
    function getCssFilePath(stylesheet) {
      var cssFilePrefix = option(wf.cssFilePrefixes, stylesheet)
      return path.join(option(o.destCssPaths, stylesheet), cssFilePrefix + o.fontBaseName + '.' + stylesheet)
    }

  /**
   * Return path of HTML demo file or `null` if its generation was disabled.
   *
   * @return {String}
   */
  function getDemoFilePath() {
    if (!o.htmlDemo) return null
    var name = o.htmlDemoFilename || o.fontBaseName
    return path.join(o.dest, name + '.html')
  }

  /**
   * Return path of HTML demo file or `null` if feature was disabled
   */
  function getDemoPath() {
    if (!o.htmlDemo) return null
    return o.dest
  }

    // Options
		var o = {
      name: 'webfont',
      target: 'target',
			fontBaseName: options.font || 'icons',
      dest: options.dest,
      relativeFontPath: options.relativeFontPath,
      fontPathVariables: options.fontPathVariables || false,
			addHashes: options.hashes !== false,
			addLigatures: options.ligatures === true,
			template: options.template,
			syntax: options.syntax || 'bem',
			templateOptions: options.templateOptions || {},
      stylesheets: options.stylesheets || [options.stylesheet || path.extname(options.template).replace(/^\./, '') || 'css'],
			htmlDemo: options.htmlDemo !== false,
			htmlDemoTemplate: options.htmlDemoTemplate,
			htmlDemoFilename: options.htmlDemoFilename,
			styles: optionToArray(options.styles, 'font,icon'),
			types: optionToArray(options.types, 'eot,woff,ttf'),
			order: optionToArray(options.order, wf.fontFormats),
			embed: options.embed === true ? ['woff'] : optionToArray(options.embed, false),
			rename: options.rename || path.basename,
			engine: options.engine || 'fontforge',
			autoHint: options.autoHint !== false,
			codepoints: options.codepoints,
			codepointsFile: options.codepointsFile,
			startCodepoint: options.startCodepoint || wf.UNICODE_PUA_START,
			ie7: options.ie7 === true,
			normalize: options.normalize === true,
			round: options.round !== undefined ? options.round : 10e12,
			fontHeight: options.fontHeight !== undefined ? options.fontHeight : 512,
			descent: options.descent !== undefined ? options.descent : 64,
			cache: options.cache || path.join(__dirname, '..', '.cache'),
			callback: options.callback,
      version: options.version !== undefined ? options.version : false,
			customOutputs: options.customOutputs
		};

		o = _.extend(o, {
			fontName: o.fontBaseName,
      destCssPaths: {
        css: o.dest,
        scss: o.dest,
        sass: o.dest,
        less: o.dest,
        styl: o.dest
      },
      relativeFontPath: o.relativeFontPath || o.dest,
			fontfaceStyles: has(o.styles, 'font'),
			baseStyles: has(o.styles, 'icon'),
			extraStyles: has(o.styles, 'extra'),
			files: files,
			glyphs: []
		});

    o.hash = getHash();
		o.fontFilename = template(options.fontFilename || o.fontBaseName, o);
    o.fontFamilyName = template(options.fontFamilyName || o.fontBaseName, o);

		// “Rename” files
		o.glyphs = o.files.map(function(file) {
			return o.rename(file).replace(path.extname(file), '');
		});
    // Check or generate codepoints
		// @todo Codepoint can be a Unicode code or character.
		var currentCodepoint = o.startCodepoint;
		if (!o.codepoints) o.codepoints = {};
		if (o.codepointsFile) o.codepoints = readCodepointsFromFile();
		o.glyphs.forEach(function(name) {
			if (!o.codepoints[name]) {
				o.codepoints[name] = getNextCodepoint();
			}
		});
		if (o.codepointsFile) saveCodepointsToFile();

    // Check if we need to generate font
		var previousHash = readHash(o.name, o.target);
		//console.log('New hash:', o.hash, '- previous hash:', previousHash);
		if (o.hash === previousHash) {
			console.log('Config and source files weren’t changed since last run, checking resulting files...');
			var regenerationNeeded = false;

			var generatedFiles = wf.generatedFontFiles(o);
			if (!generatedFiles.length){
				regenerationNeeded = true;
			}
			else {
				generatedFiles.push(getDemoFilePath());
				generatedFiles.push(getCssFilePath());

				regenerationNeeded = _.some(generatedFiles, function(filename) {
					if (!filename) return false;
					if (!fs.existsSync(filename)) {
						console.log('File', filename, ' is missed.');
						return true;
					}
					return false;
				});
			}
			if (!regenerationNeeded) {
				console.log('Font ' + chalk.cyan(o.fontName) + ' wasn’t changed since last run.');
				completeTask();
				return;
			}
		}

		// Save new hash and run
		saveHash(o.name, o.target, o.hash);
		async.waterfall([
			//createOutputDirs,
			//cleanOutputDir,
			generateFont,
			generateWoff2Font,
			generateEot2Font,
      generateStylesheets,
			generateDemoHtml,
			//generateCustomOutputs,
			printDone
		], completeTask);

    return null;
}

/**
 * Return a specified option if it exists in an object or `_default` otherwise
 *
 * @param {Object} map Options object
 * @param {String} key Option to find in the object
 * @return {Mixed}
 */
function option(map, key) {
  if (key in map) {
    return map[key];
  }
  else {
    return map._default;
  }
}

/**
 * Convert a string of comma separated words into an array
 *
 * @param {String} val Input string
 * @param {String} defVal Default value
 * @return {Array}
 */
function optionToArray(val, defVal) {
	if (val === undefined) {
		val = defVal;
	}
	if (!val) {
		return [];
	}
	if (typeof val !== 'string') {
		return val;
	}
	return val.split(',').map(_.trim);
}

/**
 * Check if a value exists in an array
 *
 * @param {Array} haystack Array to find the needle in
 * @param {Mixed} needle Value to find
 * @return {Boolean} Needle was found
 */
function has(haystack, needle) {
	return haystack.indexOf(needle) !== -1;
}


/**
 * Reat the template file
 *
 * @param {String} template Template file path
 * @param {String} syntax Syntax (bem, bootstrap, etc.)
 * @param {String} ext Extention of the template
 * @return {Object} {filename: 'Template filename', template: 'Template code'}
 */
function readTemplate(template, syntax, ext, optional) {
  var filename = template
    ? path.resolve(template.replace(path.extname(template), ext))
    : path.join(__dirname, 'templates/' + syntax + ext)

  if (fs.existsSync(filename)) {
    return {
      filename: filename,
      template: fs.readFileSync(filename, 'utf8')
    }
  }
  else if (!optional) {
    return console.error('Cannot find template at path: ' + filename)
  }
}

/**
 * Render template with error reporting
 *
 * @param {Object} template {filename: 'Template filename', template: 'Template code'}
 * @param {Object} context Template context
 * @return {String}
 */
function renderTemplate(template, context) {
  try {
    var func = _.template(template.template)
    return func(context)
  }
  catch (e) {
    console.error('Error while rendering template ' + template.filename + ': ' + e.message)
  }
}

/**
 * Basic template function: replaces {variables}
 *
 * @param {Template} tmpl Template code
 * @param {Object} context Values object
 * @return {String}
 */
function template(tmpl, context) {
	return tmpl.replace(/\{([^\}]+)\}/g, function(m, key) {
		return context[key];
	});
}

/**
 * Prepare string to use as CSS class name
 *
 * @param {String} str
 * @return {String}
 */
function classnameize(str) {
  return _.trim(str).replace(/\s+/g, '-')
}

/**
 * Append a slash to end of a filepath if it not exists and make all slashes forward
 *
 * @param {String} filepath File path
 * @return {String}
 */
function normalizePath(filepath) {
  if (!filepath.length) return filepath

  // Make all slashes forward
  filepath = filepath.replace(/\\/g, '/')

  // Make sure path ends with a slash
  if (!_.endsWith(filepath, '/')) {
    filepath += '/'
  }

  return filepath
}

module.exports.createFont = createFont;
