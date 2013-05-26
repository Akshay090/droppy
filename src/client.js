(function ($, window, document) {
    "use strict";

    var debug; // live css reload and debug logging - this is set by the server
    var smallScreen = $(window).width() < 640;
    var currentData, currentFolder, fileInput, hasLoggedOut,
        isUploading, savedParts, socket, socketOpen, socketWait;

    initVariables(); // Separately init the variables so we can init them on demand
// ============================================================================
//  Page loading functions
// ============================================================================
    $(getPage);

    function getPage() {
        $.ajax({
            url: "/content",
            success: function (data, textStatus, request) {
                load(request.getResponseHeader("X-Page-Type"), data);
            }
        });
    }

    // Switch the body's content with an animation
    function load(type, data) {
        $("body").append('<div id="newpage">' + data + '</div>');
        var newPage = $("#newpage"), oldPage = $("#page");

        switch (type) {
        case "main":
            initMainPage();
            oldPage.attr("class", "out");
            setTimeout(function () {
                $("#navigation").attr("class", "in");
                setTimeout(function () {
                    finalize();
                }, 500);
            }, 250);
            break;
        case "auth":
            initAuthPage();

            var loginform = $("#login-form");

            $("body").css("overflow", "hidden");
            loginform.css("top", smallScreen ? "20%" : "70%");
            loginform.css("opacity", 0);

            oldPage.animate({"opacity": 0}, {duration: 250, queue: false});
            loginform.animate({"opacity": 1}, {duration: 250, queue: false});
            loginform.animate({"top": smallScreen ? "0%" : "50%"}, {duration: 250, queue: false, complete : function () {
                finalize();
                $("body").removeAttr("style");
                loginform.removeAttr("style");
                if (hasLoggedOut) {
                    setTimeout(function () {
                        $("#login-info").fadeIn(300);
                    }, 300);
                }
            }});
            break;
        }

        // Switch ID of #newpage for further animation
        function finalize() {
            oldPage.remove();
            newPage.attr("id", "page");
        }
    }
// ============================================================================
//  WebSocket functions
// ============================================================================
    function openSocket() {
        if (socketOpen) return;

        if (document.location.protocol === "https:")
            socket = new WebSocket("wss://" + document.location.host);
        else
            socket = new WebSocket("ws://" + document.location.host);

        socket.onopen = function () {
            socketOpen = true;
            // Request initial update
            updateLocation(currentFolder || "/", false);

            // Close the socket to prevent Firefox errors
            $(window).on("beforeunload", function () {
                socket.close();
                socketOpen = false;
            });
        };

        socket.onmessage = function (event) {
            socketWait = false;
            var msg = JSON.parse(event.data);
            switch (msg.type) {

            case "UPDATE_FILES":
                if (isUploading) return;
                updateData(msg.folder, msg.data);
                break;
            case "UPLOAD_DONE":
                isUploading = false;
                updateTitle(currentFolder, true); // Reset title
                $(".progressBar").css("width", 0); // Reset progress bars
                updateData(msg.folder, msg.data);
                break;
            case "NEW_FOLDER":
                updateData(msg.folder, msg.data);
                break;
            case "UPDATE_CSS":
                if (debug) {
                    // Live reload the stylesheet(s) for easy designing
                    $('link[rel="stylesheet"]').remove();

                    var i = 0;
                    while (document.styleSheets[i])
                        document.styleSheets[i++].disabled = true;

                    var style = $('<style type="text/css"></style>');
                    style.text(msg.css).appendTo($("head"));
                }
                break;
            case "UNAUTHORIZED":
                // Set hasLoggedOut to stop reconnects, will get cleared on login
                hasLoggedOut = true;
                break;
            }

            function updateData(folder, data) {
                if (folder !== currentFolder.replace(/&amp;/, "&")) {
                    updateLocation(msg.folder);
                }
                updateCrumbs(msg.folder);
                currentData = data;
                buildHTML(data, folder);
            }
        };

        socket.onclose = function () {
            socketOpen = false;
            // Restart a closed socket in case it unexpectedly closes,
            // and give up after 20 seconds increasingly higher intervals.
            // Related: https://bugzilla.mozilla.org/show_bug.cgi?id=858538
            (function retry(timout) {
                if (timout === 20480 || hasLoggedOut) {
                    return;
                } else {
                    socket.socket && socket.socket.connect();
                    setTimeout(retry, timout * 2, timout * 2);
                }
            })(5);
        };
    }

    function sendMessage(msgType, msgData) {
        if (!socketOpen) return;
        startSocketWait();
        socket.send(JSON.stringify({
            type: msgType,
            data: msgData
        }));
    }


    function startSocketWait() {
        socketWait = true;
        // Unlock the UI in case we get no socket resonse after waiting for 2 seconds
        setTimeout(function () {
            socketWait = false;
        }, 2000);
    }
// ============================================================================
//  Authentication page JS
// ============================================================================
    function initAuthPage() {
        var form      = $("#form"),
            loginform = $("#login-form"),
            logininfo = $("#login-info"),
            pass      = $("#pass"),
            remember  = $("#remember"),
            submit    = $("#submit"),
            user      = $("#user");

        user.focus();

        user.unbind("keydown").keydown(function () {
            logininfo.fadeOut(300);
        });

        user.unbind("click").click(function () {
            logininfo.fadeOut(300);
        });

        // Return submits the form
        pass.unbind("keyup").keyup(function (e) {
            if (e.keyCode === 13) {
                submitForm(form, submit);
            }
        });

        // Spacebar toggles the checkbox
        remember.unbind("keyup").keyup(function (e) {
            if (e.keyCode === 32) {
                $("#check").trigger("click");
            }
        });

        form.unbind("submit").submit(function (e) {
            e.preventDefault();
            submitForm(form, submit);
        });

        user.unbind("focus").focus(function () {
            submit.removeClass("invalid");
            loginform.removeClass("invalid");
            logininfo.fadeOut(300);
        });

        pass.unbind("focus").focus(function () {
            submit.removeClass("invalid");
            loginform.removeClass("invalid");
            logininfo.fadeOut(300);
        });

        function submitForm(form) {
            $.ajax({
                type: "POST",
                url: "/login",
                data: form.serialize(),
                success: function (data) {
                    if (data === "OK") {
                        hasLoggedOut = false;
                        getPage();
                    } else {
                        submit.attr("class", "invalid");
                        loginform.attr("class", "invalid");
                    }

                }
            });
        }
    }
// ============================================================================
//  Main page JS
// ============================================================================
    function initMainPage() {
        // Open Websocket for initial update
        setTimeout(openSocket, 50);
        currentFolder = decodeURIComponent(window.location.pathname);
        hasLoggedOut = false;

        // Stop dragenter and dragover from killing our drop event
        $(document.documentElement).on("dragenter", function (e) { e.stopPropagation(); e.preventDefault(); });
        $(document.documentElement).on("dragover",  function (e) { e.stopPropagation(); e.preventDefault(); });

        // jQuery's event handler for drop doesn't get event.dataTransfer
        // http://bugs.jquery.com/ticket/10756
        $(document.documentElement)[0].addEventListener("drop", function (event) {
            event.stopPropagation();
            event.preventDefault();
            createFormdata(event.dataTransfer.files);
        });

        // Debounced window resize event
        var resizeTimeout;
        $(window).resize(function () {
            // Hide the out-of-screen about box to prevent chrome's automatic
            // resize transition sliding in the element momentarerly
            $("#about").hide();
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(function () {
                smallScreen = $(window).width() < 640;
                $("#about").show();
                checkBreadcrumbWidth();
            }, 100);
        });

        // Hide our file input form by wrapping it in a 0 x 0 div
        fileInput = $("#file").wrap($("<div/>").css({
            "height"  : 0,
            "width"   : 0,
            "overflow": "hidden"
        }));

        // All file uploads land here
        fileInput.unbind("change").change(function () {
            if ($("#file").val() !== "") {
                var files = $("#file").get(0).files;
                var num = files.length;
                var formData = new FormData();
                if (num > 0) {
                    for (var i = 0; i < num; i++) {
                        currentData[files[i].name] = {
                            size: files[i].size,
                            type: "nf"
                        };
                        formData.append(files[i].name, files[i]);
                    }
                    buildHTML(currentData, currentData.folder);
                    createFormdata(files);
                }
                $("#file").val(""); // Reset file form
            }
        });

        // Redirect the upload button click to the real, hidden form
        $("#upload").unbind("click").click(function () {
            fileInput.click();
        });

        var info        = $("#name-info"),
            nameinput   = $("#name-input"),
            nameoverlay = $("#name-overlay"),
            activeFiles;

        // Show popup for folder creation
        $("#add-folder").unbind("click").click(function () {
            activeFiles = [];
            $(".filelink, .folderlink").each(function () {
                activeFiles.push($(this).html().toLowerCase());
            });
            nameinput.val("");
            nameinput.removeClass("invalid");
            nameoverlay.removeClass("invalid");
            info.hide();
            toggleOverlay();
        });

        function toggleOverlay() {
            if (nameoverlay.attr("class") === "out") {
                nameoverlay.css("visibility", "visible");
                nameoverlay.attr("class", "in");
                setTimeout(function () {
                    nameinput.focus();
                }, 300);
            } else {
                nameoverlay.attr("class", "out");
                setTimeout(function () {
                    nameoverlay.css("visibility", "hidden");
                }, 300);
            }
        }

        // Handler for the input of the folder name
        nameinput.unbind("keyup").keyup(function (e) {
            if (e.keyCode === 27) toggleOverlay(); // Escape Key
            var input = nameinput.val();
            var valid = !input.match(/[\\*{}\/<>?|]/) && !input.match(/\.\./);
            var folderExists;
            for (var i = 0, len = activeFiles.length; i < len; i++)
                if (activeFiles[i] === input.toLowerCase()) folderExists = true;
            if (input === "") {
                nameinput.removeClass();
                nameoverlay.removeClass("valid invalid");
                info.fadeOut(300);
            } else if (!valid || folderExists) {
                nameinput.removeClass("valid").addClass("invalid");
                nameoverlay.addClass("invalid");
                info.html(folderExists ? "File or folder already exists!" : "Invalid character(s) in filename!");
                info.fadeIn(300);
            } else {
                nameinput.removeClass("invalid").addClass("valid");
                info.fadeOut(300);
                if (e.keyCode === 13) { // Return Key
                    if (currentFolder === "/")
                        sendMessage("CREATE_FOLDER", "/" + input);
                    else
                        sendMessage("CREATE_FOLDER", currentFolder + "/" + input);
                    nameoverlay.removeClass("in").addClass("out");
                }
            }
        });

        var arrow     = $("#arrow"),
            about     = $("#about");

        $(".arrow-text").unbind("click").click(function () {
            if (arrow.attr("class") === "down") {
                about.attr("class", "active");
                about.css("top", "50%");
                about.css("margin-top", "-100px");
                setTimeout(function () {
                    arrow.attr("class", "up");
                    $(".arrow-text.down").hide();
                    $(".arrow-text.up").show();
                }, 400);
            } else {
                about.css("top", "-200px");
                about.css("margin-top", "0");
                setTimeout(function () {
                    arrow.attr("class", "down");
                    about.removeAttr("class");
                    about.removeAttr("style");
                    $(".arrow-text.up").hide();
                    $(".arrow-text.down").show();
                }, 400);
            }
        });

        $("#logout").unbind("click").click(function () {
            sendMessage("LOGOUT");
            hasLoggedOut = true;
            socket.close();
            deleteCookie("sid");
            initVariables(); // Reset vars to their init state
            getPage();
        });
        // ============================================================================
        //  Helper functions for the main page
        // ============================================================================
        function createFormdata(files) {
            if (!files) return;
            var formData = new FormData();
            for (var i = 0, len = files.length; i < len; i++) {
                formData.append(files[i].name, files[i]);
            }
            uploadFiles(formData);
        }

        function uploadFiles(formData) {
            var xhr = new XMLHttpRequest();
            uploadInit();

            xhr.upload.addEventListener("progress", function (event) {
                if (event.lengthComputable) {
                    uploadProgress(event.loaded, event.total);
                }
            }, false);

            xhr.upload.addEventListener("load", function () {
                uploadDone();
            }, false);

            xhr.upload.addEventListener("error", function (event) {
                log("XHR error: " + event);
                uploadDone();
            }, false);

            isUploading = true;
            xhr.open("post", "/upload", true);
            xhr.send(formData);
        }

        var start, progressBars,
            infobox  = $("#upload-info"),
            timeleft = $("#upload-time-left"),
            uperc    = $("#upload-percentage");

        function uploadInit() {
            start = new Date().getTime();

            progressBars = $(".progressBar");
            progressBars.show();
            progressBars.width("0%");

            updateTitle("0%");
            uperc.html("0%");

            timeleft.html("");
            infobox.animate({top: "-2px"}, 250);
        }

        function uploadDone() {
            progressBars.width("100%");

            updateTitle("100%");
            uperc.html("100%");

            timeleft.html("finished");
            infobox.animate({top: "-85px"}, 250);
        }

        function uploadProgress(bytesSent, bytesTotal) {
            var progress = Math.round((bytesSent / bytesTotal) * 100) + "%";

            progressBars.width(progress);
            updateTitle(progress);
            uperc.html(progress);

            // Calculate estimated time left
            var elapsed = (new Date().getTime()) - start;
            var estimate = bytesTotal / (bytesSent / elapsed);
            var secs = (estimate - elapsed) / 1000;

            if (secs > 120) {
                timeleft.html("less than " + Math.floor((secs / 60) + 1) + " minutes left");
            } else if (secs > 60) {
                timeleft.html("less than 2 minutes left");
            } else if (secs < 1.5) {
                timeleft.html("less than a second left");
            } else {
                timeleft.html(Math.round(secs) + " seconds left");
            }
        }
    }
// ============================================================================
//  General helpers
// ============================================================================
    // Update the page title and trim a path to its basename
    function updateTitle(text, isPath) {
        var prefix = "", suffix = "droppy";

        if (isPath) {
            var parts = text.match(/([^\/]+)/gm);
            if (!parts)
                prefix = "/";
            else
                prefix = parts[parts.length - 1];
        } else {
            prefix = text;
        }
        document.title = [prefix, suffix].join(" - ");
    }

    // Listen for "popstate" events, which indicate the user navigated back
    $(window).unbind("popstate").bind("popstate", function () {
        currentFolder = decodeURIComponent(window.location.pathname);
        sendMessage("SWITCH_FOLDER", currentFolder);
    });

    // Update our current location and change the URL to it
    var nav;
    function updateLocation(path, doSwitch) {
        if (socketWait) return; // Dont switch location in case we are still waiting for a response from the server

        if (path.length > currentFolder.length)
            nav = "forward";
        else if (path.length === currentFolder.length)
            nav = "same";
        else
            nav = "back";
        currentFolder = path;
        sendMessage(doSwitch ? "SWITCH_FOLDER" : "REQUEST_UPDATE", currentFolder);

        // pushState causes Chrome's UI to flicker
        // http://code.google.com/p/chromium/issues/detail?id=50298
        window.history.pushState(null, null, currentFolder);
    }

    function updateCrumbs(path) {
        updateTitle(path, true);
        var parts = path.split("/");
        var i = 0, len, home = "";

        parts[0] = '<span class="icon">' + home + '<span>';
        if (parts[parts.length - 1] === "") parts.pop(); // Remove trailing empty string

        if (savedParts) {
            i = 1; // Skip the first element as it's always the same
            while (true) {
                if (!parts[i] && !savedParts[i]) break;
                if (parts[i] !== savedParts[i]) {
                    if (savedParts[i] && !parts[i])
                        $("#crumbs li:contains(" + savedParts[i] + ")").remove();
                    else if (parts[i] && !savedParts[i])
                        create(parts[i], path);
                }
                i++;
            }
            finalize();
        } else {
            // Delay initial slide-in
            setTimeout(function () {
                $(".placeholder").remove(); // Invisible placeholder so height:auto works during the initial animation
                for (i = 0, len = parts.length; i < len; i++)
                    create(parts[i], path);
                finalize();
            }, 300);
        }

        savedParts = parts;

        function create(name, path) {
            var li = $("<li class='out'>" + name + "</li>");
            if (name.indexOf(home) > -1)
                li.data("destination", "/");
            else
                li.data("destination", path.substring(0, path.lastIndexOf(name) + name.length));

            li.click(function () {
                updateLocation($(this).data("destination"), true);
            });

            $("#crumbs").append(li);
        }

        function finalize() {
            // Give the DOM some time to recognize our new element for transition purposes
            setTimeout(function () {
                $("#crumbs li.out").attr("class", "in");
            }, 20);
            // Remove the class after the transition and keep the list scrolled to the last element
            setTimeout(function () {
                $("#crumbs li.in").removeClass();
                checkBreadcrumbWidth();
            }, 310);
        }
    }

    function checkBreadcrumbWidth() {
        var last = $("#crumbs li:last-child");
        if (!last.position()) return;

        var margin = smallScreen ? 50 : 120;
        var space = $(window).width();
        var right = last.position().left + last.width();

        if ((right + margin) > space) {
            var needed = right - space + margin;
            $("#crumbs").animate({"left": -needed}, {duration: 200});
        } else {
            if ($("#crumbs").css("left") !== 0)
                $("#crumbs").animate({"left": 0}, {duration: 200});
        }
    }

    function buildHTML(fileList, root) {
        var list = $("<ul></ul>");
        for (var file in fileList) {
            var size = convertToSI(fileList[file].size);
            var type = fileList[file].type;
            var id = (root === "/") ? "/" + file : root + "/" + file;

            if (type === "f" || type === "nf") { // Create a file row
                var downloadURL = window.location.protocol + "//" + window.location.host + "/get" + encodeURIComponent(id);
                var addProgress = type === "nf" ? '<div class="progressBar"></div>' : "";
                list.append(
                    '<li class="data-row" data-type="file" data-id="' + id + '"><span class="icon icon-file"></span>' +
                    '<a class="filelink" href="' + downloadURL + '" download="' + file + '">' + file + '</a>' +
                    '<span class="icon-delete icon"></span><span class="data-info">' + size + '</span>' + addProgress + '</li>'
                );
            } else {  // Create a folder row
                list.append(
                    '<li class="data-row" data-type="folder" data-id="' + id + '"><span class="icon icon-folder"></span>' +
                    '<span class="folderlink">' + file + '</span><span class="icon-delete icon"></span></li>'
                );
            }
        }

        // Sort first by class, then alphabetically
        var items = $(list).children("li");
        items.sort(function (a, b) {
            var result = $(b).data("type").toUpperCase().localeCompare($(a).data("type").toUpperCase());
            return result ? result : $(a).text().toUpperCase().localeCompare($(b).text().toUpperCase());
        });

        var count = 0;
        $.each(items, function (index, item) {
            $(item).attr("data-index", index);
            list.append(item);
            count++;
        });

        if (count > 0)
            loadContent(list);
        else {
            $("#content").html('<div id="empty"><div id="empty-text">There appears to be<br>nothing here. Drop files<br>into this window or<br><span id="upload-inline"><span class="icon"></span> Add files</span></div></div>');
            $("#upload-inline").unbind("click").click(function () {
                fileInput.click();
            });
            nav = "same";
        }
    }

    function loadContent(list) {
        // Load generated list into view with an animation
        if (nav === "same") {
            finalize(true);
            return;
        } else {
            $("#page").append($("<section id='newcontent'></section>"));
            $("#newcontent").addClass(nav === "forward" ? "new-right" : "new-left");
            $("#newcontent").html(list);
            $(".data-row").addClass("animating");
            // Give the DOM some time to recognize our new element for transition purposes
            setTimeout(function () {
                $("#content").remove();
                $("#newcontent").attr("id", "content");
                $("#content").removeAttr("class");
                $(".data-row").removeClass("animating");
                finalize();
            }, 20);

        }

        function finalize(samePage) {
            if (samePage) $("#content").html(list);
            bindEvents();
            colorize();
            nav = "same";
        }
    }

    function bindEvents() {
        /* TODO: file moving
        $(".data-row").draggable({
            addClasses: false,
            axis: "y",
            cursor: "move",
            delay: 200,
            revert: true,
            scroll: true
        }); */

        // Bind mouse event to switch into a folder
        $(".data-row[data-type='folder']").unbind("click").click(function (e) {
            if (e.button !== 0) return;

            var destination = $(this).data("id").replace("&amp;", "&");
            updateLocation(destination, true);
        });
        // Bind mouse event to delete a file/folder
        $(".icon-delete").unbind("click").click(function (e) {
            if (e.button !== 0 || socketWait) return;
            sendMessage("DELETE_FILE", $(this).parent().data("id"));
        });
    }

    function colorize() {
        $(".filelink").each(function () {
            var filename = $(this).attr("download");
            var colors = [], dot = filename.lastIndexOf(".");

            if (dot > -1 && dot < filename.length)
                colors = colorFromString(filename.substring(dot + 1, filename.length));
            else
                colors = colorFromString(filename);

            var red   = colors[0];
            var green = colors[1];
            var blue  = colors[2];

            if (red > 180)   red = 180;
            if (green > 180) green = 180;
            if (blue > 180)  blue = 180;

            if (red < 60)    red = 60;
            if (green < 60)  green = 60;
            if (blue < 60)   blue = 60;

            $(this).parent().children(".icon-file").css("color", "#" + red.toString(16) + green.toString(16) + blue.toString(16));
        });
    }

    function deleteCookie(name) {
        document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:01 GMT;";
    }

    function initVariables() {
        currentData = false;
        currentFolder = false;
        isUploading = false;
        savedParts = false;
        socket = false;
        socketOpen = false;
        socketWait = false;
    }

    function convertToSI(bytes) {
        var step = 0, units = ["bytes", "KiB", "MiB", "GiB", "TiB"];
        while (bytes >= 1024) {
            bytes /= 1024;
            step++;
        }
        return [(step === 0) ? bytes : bytes.toFixed(2), units[step]].join(" ");
    }

    // get RGB color values for a given string
    // based on https://github.com/garycourt/murmurhash-js
    function colorFromString(string) {
        var remainder, bytes, h1, h1b, c1, c2, k1, i;
        remainder = string.length & 3;
        bytes = string.length - remainder;
        h1 = 0; // Seed value
        c1 = 0xcc9e2d51;
        c2 = 0x1b873593;
        i = 0;

        while (i < bytes) {
            k1 = ((string.charCodeAt(i) & 0xff)) |
                 ((string.charCodeAt(++i) & 0xff) << 8) |
                 ((string.charCodeAt(++i) & 0xff) << 16) |
                 ((string.charCodeAt(++i) & 0xff) << 24);
            ++i;
            k1 = ((((k1 & 0xffff) * c1) + ((((k1 >>> 16) * c1) & 0xffff) << 16))) & 0xffffffff;
            k1 = (k1 << 15) | (k1 >>> 17);
            k1 = ((((k1 & 0xffff) * c2) + ((((k1 >>> 16) * c2) & 0xffff) << 16))) & 0xffffffff;
            h1 ^= k1;
            h1 = (h1 << 13) | (h1 >>> 19);
            h1b = ((((h1 & 0xffff) * 5) + ((((h1 >>> 16) * 5) & 0xffff) << 16))) & 0xffffffff;
            h1 = (((h1b & 0xffff) + 0x6b64) + ((((h1b >>> 16) + 0xe654) & 0xffff) << 16));
        }
        k1 = 0;
        switch (remainder) {
            case 3: k1 ^= (string.charCodeAt(i + 2) & 0xff) << 16;
            case 2: k1 ^= (string.charCodeAt(i + 1) & 0xff) << 8;
            case 1: k1 ^= (string.charCodeAt(i) & 0xff);
            k1 = (((k1 & 0xffff) * c1) + ((((k1 >>> 16) * c1) & 0xffff) << 16)) & 0xffffffff;
            k1 = (k1 << 15) | (k1 >>> 17);
            k1 = (((k1 & 0xffff) * c2) + ((((k1 >>> 16) * c2) & 0xffff) << 16)) & 0xffffffff;
            h1 ^= k1;
        }
        h1 ^= string.length;
        h1 ^= h1 >>> 16;
        h1 = (((h1 & 0xffff) * 0x85ebca6b) + ((((h1 >>> 16) * 0x85ebca6b) & 0xffff) << 16)) & 0xffffffff;
        h1 ^= h1 >>> 13;
        h1 = ((((h1 & 0xffff) * 0xc2b2ae35) + ((((h1 >>> 16) * 0xc2b2ae35) & 0xffff) << 16))) & 0xffffffff;
        h1 ^= h1 >>> 16;

        var result = h1 >>> 0;
        var colors = [];
        var j = 3;
        while (j) {
            colors[--j] = result & (255);
            result = result >> 8;
        }
        return colors;
    }

    function log(msg) {
        if (debug) console.log(msg);
    }

    window.onerror = function (msg, url, line) {
        console.log("JS Error: " + msg + " @" + line + " of " + url);
        return true;
    };
}(jQuery, window, document));